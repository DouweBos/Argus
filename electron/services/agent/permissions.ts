/**
 * File-based IPC bridge between Claude Code's `PreToolUse` hook and the
 * Stagehand frontend for interactive permission prompts.
 *
 * When an agent is spawned a {@link PermissionBroker} creates a temp directory
 * with a Python hook script and a settings JSON file. Claude Code is started
 * with `--settings <path>` so its `PreToolUse` hook calls our script.
 *
 * The hook script writes a `.req` file and polls for a matching `.res` file.
 * A `setInterval` inside the broker watches for `.req` files, emits Electron
 * IPC events, and the frontend responds via `respondToPermission` which writes
 * the `.res` file — completing the round-trip.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getMainWindow } from "../../main";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Tools that require user permission before executing. */
const PERMISSION_MATCHER =
  "Edit|Write|Bash|MultiEdit|NotebookEdit|WebFetch";

/** Polling interval in milliseconds — mirrors the Rust 150 ms sleep. */
const POLL_INTERVAL_MS = 150;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** A parsed allow rule like `Bash(npm *)` or `Edit(**\/*.tsx)`. */
interface AllowRule {
  /** Tool name, e.g. `Bash`, `Edit`, `Write`. */
  tool: string;
  /**
   * Optional glob pattern over the tool-specific specifier.
   * `null` means "match all uses of this tool".
   */
  specifier: string | null;
}

/** Payload emitted as an `agent:permission:{agentId}` event. */
export interface PermissionRequest {
  tool_input: unknown;
  tool_name: string;
  tool_use_id: string;
}

// ---------------------------------------------------------------------------
// PermissionBroker
// ---------------------------------------------------------------------------

/**
 * Manages the file-based IPC bridge for a single agent's permission prompts.
 */
export class PermissionBroker {
  /** Directory for request / response files and the hook script. */
  private readonly permDir: string;

  /** Path to the generated Claude Code settings JSON file. */
  private readonly _settingsFilePath: string;

  /** Polling interval handle; cleared on cleanup. */
  private pollHandle: ReturnType<typeof setInterval> | null = null;

  /** Rules the user has approved for the rest of the session. */
  private readonly allowedRules: AllowRule[] = [];

  /**
   * Create a new broker: writes the hook script + settings file and starts a
   * polling interval that watches for `.req` files.
   *
   * @throws string if the temp directory or any file cannot be created.
   */
  constructor(agentId: string) {
    this.permDir = path.join(
      os.tmpdir(),
      "stagehand-perms",
      agentId,
    );

    fs.mkdirSync(this.permDir, { recursive: true });

    // Write the Python hook script.
    const hookScriptPath = path.join(this.permDir, "hook.py");
    writeHookScript(hookScriptPath, this.permDir);

    try {
      fs.chmodSync(hookScriptPath, 0o755);
    } catch {
      // Non-fatal on platforms that don't support chmod.
    }

    // Write the settings JSON that tells Claude Code about our hook.
    this._settingsFilePath = path.join(this.permDir, "settings.json");
    writeSettingsFile(this._settingsFilePath, hookScriptPath);

    // Start the polling interval.
    this.pollHandle = setInterval(
      () => this.pollRequests(agentId),
      POLL_INTERVAL_MS,
    );
  }

  /** Absolute path to the settings JSON — pass to `--settings`. */
  get settingsFilePath(): string {
    return this._settingsFilePath;
  }

  /**
   * Write a `.res` file so the blocking hook script can continue.
   *
   * `decision` should be `"allow"` or `"deny"`.
   *
   * @throws string if the response file cannot be written.
   */
  respond(toolUseId: string, decision: string, reason?: string): void {
    const reasonStr =
      reason ??
      (decision === "allow" ? "User approved" : "User denied");

    const response = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reasonStr,
      },
    });

    const respPath = path.join(this.permDir, `${toolUseId}.res`);
    try {
      fs.writeFileSync(respPath, response, "utf8");
    } catch (e) {
      throw `Failed to write permission response: ${String(e)}`;
    }
  }

  /**
   * Add a rule to the session-level allow list.
   *
   * `ruleStr` follows Claude CLI format: `Tool` or `Tool(specifier)`.
   * Future matching permission requests will be auto-approved by the polling
   * interval without prompting the user.
   */
  allowRule(ruleStr: string): void {
    const parsed = parseAllowRule(ruleStr);
    this.allowedRules.push(parsed);
  }

  /**
   * Stop the polling interval and remove the temp directory.
   */
  cleanup(): void {
    if (this.pollHandle !== null) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    try {
      fs.rmSync(this.permDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup.
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Called on each polling tick. Scans the permission directory for `.req`
   * files, auto-approves ones that match a session rule, and emits
   * `agent:permission:{agentId}` events for the rest.
   *
   * After a request is detected and emitted, the `.req` file is renamed to
   * `.pending` to avoid duplicate emissions. The hook script only watches for
   * `.res` files, so this rename is transparent to it.
   */
  private pollRequests(agentId: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this.permDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.name.endsWith(".req")) {
        continue;
      }

      const reqPath = path.join(this.permDir, entry.name);

      let content: string;
      try {
        content = fs.readFileSync(reqPath, "utf8");
      } catch {
        // File might still be mid-write (race with the hook script).
        continue;
      }

      let data: Record<string, unknown>;
      try {
        data = JSON.parse(content) as Record<string, unknown>;
      } catch {
        // Incomplete write — skip for now and retry next tick.
        continue;
      }

      const toolUseId =
        typeof data["tool_use_id"] === "string" ? data["tool_use_id"] : "";
      const toolName =
        typeof data["tool_name"] === "string" ? data["tool_name"] : "";
      const toolInput = data["tool_input"] ?? null;

      if (!toolUseId) {
        continue;
      }

      // Auto-approve if any session rule matches this request.
      const specifier = extractSpecifier(
        toolName,
        toolInput as Record<string, unknown>,
      );
      const isAllowed = this.allowedRules.some((rule) => {
        if (rule.tool !== toolName) return false;
        if (rule.specifier === null) return true; // Bare tool — allow all uses.
        if (specifier === null) return false;
        return globMatch(rule.specifier, specifier);
      });

      if (isAllowed) {
        const response = JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "allow",
            permissionDecisionReason: "Matched session allow rule",
          },
        });
        const respPath = path.join(this.permDir, `${toolUseId}.res`);
        try {
          fs.writeFileSync(respPath, response, "utf8");
        } catch {
          // Non-fatal.
        }
        try {
          fs.renameSync(reqPath, reqPath.replace(/\.req$/, ".pending"));
        } catch {
          // Non-fatal.
        }
        continue;
      }

      // Emit the permission request to the frontend.
      const request: PermissionRequest = {
        tool_use_id: toolUseId,
        tool_name: toolName,
        tool_input: toolInput,
      };

      getMainWindow()?.webContents.send(
        `agent:permission:${agentId}`,
        request,
      );

      // Rename to .pending to avoid re-emitting on the next tick.
      try {
        fs.renameSync(reqPath, reqPath.replace(/\.req$/, ".pending"));
      } catch {
        // Non-fatal.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// File generators
// ---------------------------------------------------------------------------

/**
 * Write the Python hook script that bridges Claude Code -> file IPC.
 *
 * Content is identical to the Rust `write_hook_script` function.
 *
 * @throws string if the file cannot be written.
 */
function writeHookScript(scriptPath: string, permDir: string): void {
  // Use forward slashes in the embedded path — Python handles them on all
  // platforms and avoids backslash-escaping issues on Windows.
  const permDirStr = permDir.replace(/\\/g, "/");

  const script = `#!/usr/bin/env python3
"""Stagehand PreToolUse hook — bridges Claude Code permission requests to the UI."""
import json, os, sys, time

PERM_DIR = "${permDirStr}"
TIMEOUT = 120

def log(msg):
    print(f"[stagehand-hook] {msg}", file=sys.stderr)

def main():
    try:
        data = json.load(sys.stdin)
    except Exception as e:
        log(f"Failed to parse stdin: {e}")
        sys.exit(0)

    tool_use_id = data.get("tool_use_id", "")
    tool_name = data.get("tool_name", "unknown")
    if not tool_use_id:
        log("No tool_use_id in request")
        sys.exit(0)

    log(f"Permission request: {tool_name} ({tool_use_id})")

    if not os.path.isdir(PERM_DIR):
        log(f"PERM_DIR does not exist: {PERM_DIR}")
        sys.exit(0)

    req_path = os.path.join(PERM_DIR, tool_use_id + ".req")
    res_path = os.path.join(PERM_DIR, tool_use_id + ".res")

    # Atomic write: tmp -> rename.
    tmp_path = req_path + ".tmp"
    try:
        with open(tmp_path, "w") as f:
            json.dump(data, f)
        os.rename(tmp_path, req_path)
    except Exception as e:
        log(f"Failed to write request file: {e}")
        sys.exit(0)

    # Poll for response.
    deadline = time.time() + TIMEOUT
    while time.time() < deadline:
        if os.path.exists(res_path):
            try:
                with open(res_path) as f:
                    response = f.read()
                os.unlink(res_path)
            except Exception:
                response = ""
            # Clean up req/pending files.
            for ext in (".req", ".pending"):
                try:
                    os.unlink(os.path.join(PERM_DIR, tool_use_id + ext))
                except Exception:
                    pass
            print(response)
            sys.exit(0)
        time.sleep(0.15)

    # Timeout -- deny.
    log(f"Timed out waiting for response: {tool_name} ({tool_use_id})")
    for ext in (".req", ".pending"):
        try:
            os.unlink(os.path.join(PERM_DIR, tool_use_id + ext))
        except Exception:
            pass
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": "Permission request timed out"
        }
    }))
    sys.exit(0)

if __name__ == "__main__":
    main()
`;

  try {
    fs.writeFileSync(scriptPath, script, "utf8");
  } catch (e) {
    throw `Failed to write hook script: ${String(e)}`;
  }
}

/**
 * Write a Claude Code settings JSON file with the `PreToolUse` hook config.
 *
 * Content is identical to the Rust `write_settings_file` function.
 *
 * @throws string if the file cannot be written.
 */
function writeSettingsFile(settingsPath: string, hookScriptPath: string): void {
  const settings = {
    hooks: {
      PreToolUse: [
        {
          matcher: PERMISSION_MATCHER,
          hooks: [
            {
              type: "command",
              command: hookScriptPath,
              timeout: 120,
            },
          ],
        },
      ],
    },
  };

  const jsonStr = JSON.stringify(settings);
  try {
    fs.writeFileSync(settingsPath, jsonStr, "utf8");
  } catch (e) {
    throw `Failed to write settings file: ${String(e)}`;
  }
}

// ---------------------------------------------------------------------------
// Rule parsing & matching
// ---------------------------------------------------------------------------

/**
 * Parse a rule string like `Bash(npm *)` or `Edit(**\/*.tsx)` into an
 * {@link AllowRule}.
 */
export function parseAllowRule(ruleStr: string): AllowRule {
  const openParen = ruleStr.indexOf("(");
  if (openParen !== -1) {
    const tool = ruleStr.slice(0, openParen);
    // Strip trailing ')' from specifier.
    const specifier = ruleStr.slice(openParen + 1).replace(/\)$/, "");
    return { tool, specifier };
  }
  // Bare tool name — matches all uses.
  return { tool: ruleStr, specifier: null };
}

/**
 * Extract the specifier string from a permission request's tool input.
 *
 * Produces the value that the rule's glob pattern is matched against:
 * - Bash       -> the full command string
 * - Edit/Write/Read -> the file path
 * - WebFetch   -> `domain:<hostname>`
 */
export function extractSpecifier(
  toolName: string,
  toolInput: Record<string, unknown> | null | undefined,
): string | null {
  if (!toolInput) return null;

  switch (toolName) {
    case "Bash": {
      const cmd = toolInput["command"];
      return typeof cmd === "string" ? cmd : null;
    }
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "Read": {
      const fp = toolInput["file_path"] ?? toolInput["path"];
      return typeof fp === "string" ? fp : null;
    }
    case "WebFetch": {
      const url = toolInput["url"];
      if (typeof url !== "string") return null;
      const afterScheme = url.includes("://")
        ? url.slice(url.indexOf("://") + 3)
        : url;
      const host = afterScheme.split("/")[0]?.split(":")[0] ?? "";
      return host ? `domain:${host}` : null;
    }
    default:
      return null;
  }
}

/**
 * Minimal glob matcher supporting `*` (any chars except `/`) and `**` (any
 * chars including `/`), plus `?` (single non-`/` char).
 *
 * Used instead of an external `minimatch` dependency so the electron bundle
 * stays lean.
 */
export function globMatch(pattern: string, value: string): boolean {
  // Build a regex from the glob pattern.
  let regexStr = "^";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        // `**` matches any sequence of characters including path separators.
        regexStr += ".*";
        i += 2;
        // Consume an optional following `/`.
        if (pattern[i] === "/") i++;
      } else {
        // `*` matches any sequence of characters except `/`.
        regexStr += "[^/]*";
        i++;
      }
    } else if (ch === "?") {
      regexStr += "[^/]";
      i++;
    } else {
      // Escape all other regex-special characters.
      regexStr += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      i++;
    }
  }
  regexStr += "$";

  try {
    return new RegExp(regexStr).test(value);
  } catch {
    // Fallback to simple string includes for malformed patterns.
    return value.includes(pattern);
  }
}
