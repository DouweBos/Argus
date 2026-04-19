/**
 * Claude Code statusline tap — install/uninstall.
 *
 * Claude Code exposes rich per-render usage data (rate limits, context window,
 * cost, duration) only by piping a JSON blob into whatever command is set at
 * `statusLine.command` in `~/.claude/settings.json`. To surface that data in
 * Argus, we install a tiny shell script that:
 *
 *   1. Writes the JSON blob to `~/.argus/claude-status.json` (atomic rename).
 *   2. If the user had a previous statusline command, chains to it so their
 *      terminal statusline keeps rendering exactly as before.
 *
 * Installing is reversible — we back up the previous `statusLine` config and
 * restore it on uninstall.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLogger } from "../../../app/lib/logger";

const log = createLogger("claude:statusline-hook");

const ARGUS_DIR = path.join(os.homedir(), ".argus");
const HOOK_SCRIPT = path.join(ARGUS_DIR, "claude-statusline-hook.sh");
const STATUS_FILE = path.join(ARGUS_DIR, "claude-status.json");
const CHAIN_FILE = path.join(ARGUS_DIR, "claude-statusline-chain");
const CLAUDE_SETTINGS = path.join(os.homedir(), ".claude", "settings.json");

const HOOK_COMMAND = `bash ${HOOK_SCRIPT}`;

const HOOK_BODY = `#!/usr/bin/env bash
# Argus statusline tap — captures Claude Code's statusline JSON so the Argus
# UI can show rate-limit and context usage live. Do not edit; managed by Argus.
set -u
input=$(cat)
dir="${ARGUS_DIR}"
mkdir -p "$dir"
tmp="$dir/claude-status.json.tmp"
printf '%s' "$input" > "$tmp" && mv -f "$tmp" "$dir/claude-status.json"

chain_file="$dir/claude-statusline-chain"
if [ -s "$chain_file" ]; then
  cmd=$(cat "$chain_file")
  if [ -n "$cmd" ]; then
    printf '%s' "$input" | sh -c "$cmd"
  fi
fi
`;

export interface ClaudeSettingsFile {
  [key: string]: unknown;
  statusLine?: Record<string, unknown> & {
    command?: string;
    type?: string;
  };
}

export function statusFilePath(): string {
  return STATUS_FILE;
}

export function hookScriptPath(): string {
  return HOOK_SCRIPT;
}

function readSettings(): ClaudeSettingsFile {
  try {
    const raw = fs.readFileSync(CLAUDE_SETTINGS, "utf8");

    return JSON.parse(raw) as ClaudeSettingsFile;
  } catch {
    return {};
  }
}

function writeSettings(settings: ClaudeSettingsFile): void {
  fs.mkdirSync(path.dirname(CLAUDE_SETTINGS), { recursive: true });
  fs.writeFileSync(
    CLAUDE_SETTINGS,
    `${JSON.stringify(settings, null, 2)}\n`,
    "utf8",
  );
}

export function isHookInstalled(): boolean {
  if (!fs.existsSync(HOOK_SCRIPT)) {
    return false;
  }
  const settings = readSettings();
  const current = settings.statusLine?.command;

  return typeof current === "string" && current.includes(HOOK_SCRIPT);
}

export interface HookStatus {
  chained_command: string | null;
  hook_installed: boolean;
  hook_script_path: string;
  previous_command: string | null;
  status_file_path: string;
}

export function getHookStatus(): HookStatus {
  const installed = isHookInstalled();
  const settings = readSettings();
  let chain: string | null = null;
  try {
    chain = fs.readFileSync(CHAIN_FILE, "utf8").trim() || null;
  } catch {
    chain = null;
  }

  return {
    chained_command: chain,
    hook_installed: installed,
    hook_script_path: HOOK_SCRIPT,
    previous_command: installed
      ? chain
      : (settings.statusLine?.command ?? null),
    status_file_path: STATUS_FILE,
  };
}

export function installHook(): HookStatus {
  fs.mkdirSync(ARGUS_DIR, { recursive: true });
  fs.writeFileSync(HOOK_SCRIPT, HOOK_BODY, { encoding: "utf8", mode: 0o755 });
  fs.chmodSync(HOOK_SCRIPT, 0o755);

  const settings = readSettings();
  const existing = settings.statusLine?.command;
  if (typeof existing === "string" && !existing.includes(HOOK_SCRIPT)) {
    fs.writeFileSync(CHAIN_FILE, existing, "utf8");
    log.info("captured previous statusline command for chaining");
  }

  settings.statusLine = {
    ...(settings.statusLine ?? {}),
    command: HOOK_COMMAND,
    type: "command",
  };
  writeSettings(settings);
  log.info("statusline hook installed", { path: HOOK_SCRIPT });

  return getHookStatus();
}

export function uninstallHook(): HookStatus {
  let restored: string | null = null;
  try {
    restored = fs.readFileSync(CHAIN_FILE, "utf8").trim() || null;
  } catch {
    restored = null;
  }

  const settings = readSettings();
  if (settings.statusLine) {
    if (restored) {
      settings.statusLine = {
        ...settings.statusLine,
        command: restored,
        type: settings.statusLine.type ?? "command",
      };
    } else {
      delete settings.statusLine;
    }
    writeSettings(settings);
  }

  try {
    fs.unlinkSync(CHAIN_FILE);
  } catch {
    // ok — chain file may not exist
  }
  try {
    fs.unlinkSync(HOOK_SCRIPT);
  } catch {
    // ok — script may already be gone
  }
  log.info("statusline hook uninstalled");

  return getHookStatus();
}
