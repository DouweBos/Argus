/**
 * Claude Code CLI subprocess management.
 *
 * Spawns `claude --print --output-format stream-json --input-format
 * stream-json --verbose --settings <path>` as a child process with piped
 * stdin/stdout. A `readline` interface drains stdout line by line and forwards
 * each JSON line to the renderer as an `agent:event:{agentId}` IPC event.
 *
 * # Event contract
 *
 * | IPC channel                   | Payload                        |
 * |-------------------------------|--------------------------------|
 * | `agent:event:{agentId}`       | Raw JSON string (one per line) |
 * | `agent:exit:{agentId}`        | Exit code (number)             |
 * | `agent:status:{agentId}`      | Status string                  |
 * | `agent:permission:{agentId}`  | PermissionRequest object       |
 *
 * # Input contract
 *
 * User messages are written to the child's stdin as a single JSON line:
 * ```json
 * {"type":"user","message":{"role":"user","content":[{"type":"text","text":"…"}]}}
 * ```
 */

import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import readline from "node:readline";

import { getMainWindow } from "../../main";
import { appState } from "../../state";
import type { AgentInfo, AgentSession, AgentStatusValue } from "./models";
import { PermissionBroker } from "./permissions";

const execFileAsync = promisify(execFile);

/** The executable name used to invoke the Claude Code CLI. */
const CLAUDE_BIN = "claude";

// ---------------------------------------------------------------------------
// check_claude_cli
// ---------------------------------------------------------------------------

/**
 * Check whether the `claude` CLI binary is available on `$PATH`.
 *
 * Returns the resolved absolute path on success, or throws a descriptive
 * string when the binary cannot be found.
 *
 * @throws string if `which` fails or the binary is not found.
 */
export async function checkClaudeCli(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("which", [CLAUDE_BIN]);
    const resolved = stdout.trim();
    if (!resolved) {
      throw `Claude Code CLI (\`${CLAUDE_BIN}\`) not found on PATH. Install it first: https://docs.anthropic.com/en/docs/claude-code`;
    }
    return resolved;
  } catch (e) {
    if (typeof e === "string") throw e;
    throw `Claude Code CLI (\`${CLAUDE_BIN}\`) not found on PATH. Install it first: https://docs.anthropic.com/en/docs/claude-code`;
  }
}

// ---------------------------------------------------------------------------
// start_agent
// ---------------------------------------------------------------------------

/**
 * Spawn a new `claude` CLI process for the given workspace.
 *
 * Claude is started in `--output-format stream-json` mode so that the
 * renderer receives structured JSON events. A `PreToolUse` hook is configured
 * via `--settings` so write-tools trigger an interactive permission prompt in
 * the Stagehand frontend.
 *
 * Returns an {@link AgentInfo} containing the generated `agentId`.
 *
 * @throws string if the workspace is not found or the process cannot be
 *   spawned.
 */
export function startAgent(
  workspaceId: string,
  model?: string,
  permissionMode?: string,
  resumeSessionId?: string,
): AgentInfo {
  // Verify the workspace exists and grab its path.
  const workspace = appState.workspaces.get(workspaceId);
  if (!workspace) {
    throw `Workspace not found: ${workspaceId}`;
  }
  const worktreePath = workspace.path;

  const agentId = crypto.randomUUID();

  // Create the permission broker (hook script + polling interval).
  const broker = new PermissionBroker(agentId);
  const settingsPath = broker.settingsFilePath;

  // Build extra CLI args.
  const args: string[] = [
    "--print",
    "--output-format",
    "stream-json",
    "--input-format",
    "stream-json",
    "--verbose",
    "--settings",
    settingsPath,
  ];

  if (model) {
    args.push("--model", model);
  }
  if (permissionMode) {
    args.push("--permission-mode", permissionMode);
  }
  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
  }

  const child = spawn(CLAUDE_BIN, args, {
    cwd: worktreePath,
    stdio: ["pipe", "pipe", "pipe"],
    // Inherit the current process environment so PATH, HOME, and any API
    // keys are available to the child.
    env: process.env,
  });

  if (!child.stdin || !child.stdout || !child.stderr) {
    broker.cleanup();
    throw `Failed to acquire stdio pipes for agent ${agentId}`;
  }

  const stdin = child.stdin;

  // Drain stderr and log each line (mirrors the Rust fire-and-forget thread).
  child.stderr.on("data", (chunk: Buffer) => {
    const lines = chunk.toString().split("\n");
    for (const line of lines) {
      if (line.trim()) {
        console.warn(`[agent:${agentId}] stderr:`, line);
      }
    }
  });

  // Drain stdout line by line and forward each JSON line as an IPC event.
  const rl = readline.createInterface({
    input: child.stdout,
    crlfDelay: Infinity,
  });

  const eventChannel = `agent:event:${agentId}`;

  rl.on("line", (line) => {
    if (!line.trim()) return; // Skip blank separator lines.
    getMainWindow()?.webContents.send(eventChannel, line);
  });

  // When the process exits update agent status and emit the exit event.
  child.on("close", (code) => {
    const exitCode = code ?? 0;

    const session = appState.agents.get(agentId);
    if (session) {
      session.status = exitCode === 0 ? "stopped" : "error";
    }

    getMainWindow()?.webContents.send(`agent:exit:${agentId}`, exitCode);
    console.info(
      `[agent:${agentId}] process exited with code ${exitCode}`,
    );
  });

  const session: AgentSession = {
    agentId,
    workspaceId,
    stdin,
    child,
    status: "running",
    permissionBroker: broker,
  };

  appState.agents.set(agentId, session);

  emitAgentStatus(agentId, "running");
  console.info(`[agent:${agentId}] started for workspace ${workspaceId}`);

  return {
    agent_id: agentId,
    workspace_id: workspaceId,
    status: "running",
  };
}

// ---------------------------------------------------------------------------
// stop_agent
// ---------------------------------------------------------------------------

/**
 * Kill the Claude Code process for the given agent and remove it from state.
 *
 * @throws string if no agent is found with the given ID.
 */
export function stopAgent(agentId: string): void {
  const session = appState.agents.get(agentId);
  if (!session) {
    throw `No agent found: ${agentId}`;
  }

  session.status = "stopped";

  try {
    session.child.kill();
  } catch (e) {
    // The process may have already exited; treat as non-fatal.
    console.info(
      `[agent:${agentId}] child.kill() returned: ${String(e)}`,
    );
  }

  // Cleanup the permission broker before removing the session.
  session.permissionBroker?.cleanup();

  appState.agents.delete(agentId);

  emitAgentStatus(agentId, "stopped");
  console.info(`[agent:${agentId}] stopped`);
}

// ---------------------------------------------------------------------------
// interrupt_agent
// ---------------------------------------------------------------------------

/**
 * Send SIGINT to the Claude Code process to interrupt the current prompt
 * without killing the agent. The process stays alive and returns to an idle
 * state, ready for the next message.
 *
 * @throws string if no agent is found or the signal cannot be delivered.
 */
export function interruptAgent(agentId: string): void {
  const session = appState.agents.get(agentId);
  if (!session) {
    throw `No agent found: ${agentId}`;
  }

  const pid = session.child.pid;
  if (pid === undefined) {
    throw `Agent process has no PID: ${agentId}`;
  }

  try {
    process.kill(pid, "SIGINT");
  } catch (e) {
    throw `Failed to send SIGINT to agent ${agentId} (pid ${pid}): ${String(e)}`;
  }

  console.info(`[agent:${agentId}] sent SIGINT (pid ${pid})`);
}

// ---------------------------------------------------------------------------
// send_agent_message
// ---------------------------------------------------------------------------

/**
 * Image attachment to include in a user message.
 */
export interface ImageAttachment {
  /** Base64-encoded image data (no data-URL prefix). */
  data: string;
  /** MIME type, e.g. `image/png`, `image/jpeg`. */
  media_type: string;
}

/**
 * Send a user message to the agent's stdin as a stream-json formatted line.
 *
 * Optionally includes base64-encoded image attachments as image content blocks
 * placed before the text block.
 *
 * @throws string if no running agent is found or the write fails.
 */
export function sendAgentMessage(
  agentId: string,
  message: string,
  images?: Array<ImageAttachment>,
): void {
  const session = appState.agents.get(agentId);
  if (!session) {
    throw `No agent found: ${agentId}`;
  }
  if (session.status !== "running") {
    throw `Agent is not running: ${agentId}`;
  }

  const payload = buildUserMessagePayload(message, images ?? []);

  try {
    session.stdin.write(payload + "\n");
  } catch (e) {
    throw `Failed to write to agent stdin: ${String(e)}`;
  }
}

// ---------------------------------------------------------------------------
// list_agents
// ---------------------------------------------------------------------------

/**
 * Return all agents for a given workspace.
 */
export function listAgents(workspaceId: string): AgentInfo[] {
  const result: AgentInfo[] = [];
  for (const session of appState.agents.values()) {
    if (session.workspaceId === workspaceId) {
      result.push({
        agent_id: session.agentId,
        workspace_id: session.workspaceId,
        status: session.status,
      });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// respond_to_permission
// ---------------------------------------------------------------------------

/**
 * Respond to a pending permission request from the Claude Code `PreToolUse`
 * hook. Writes a `.res` file that unblocks the hook script.
 *
 * `decision` must be `"allow"` or `"deny"`.
 * `allowRule` is a Claude CLI-style rule like `Bash(npm *)` or
 * `Edit(**\/*.tsx)`. Only registered when `allowAll` is true.
 *
 * @throws string if no agent or broker is found.
 */
export function respondToPermission(
  agentId: string,
  toolUseId: string,
  decision: "allow" | "deny",
  allowRule?: string,
  allowAll?: boolean,
): void {
  const session = appState.agents.get(agentId);
  if (!session) {
    throw `No agent found: ${agentId}`;
  }

  const broker = session.permissionBroker;
  if (!broker) {
    throw `Agent has no permission broker: ${agentId}`;
  }

  // If the user chose "always allow", register the rule for the session.
  if (allowAll === true && allowRule) {
    broker.allowRule(allowRule);
  }

  broker.respond(toolUseId, decision);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Emit an `agent:status:{agentId}` event to the renderer.
 */
function emitAgentStatus(agentId: string, status: AgentStatusValue): void {
  getMainWindow()?.webContents.send(`agent:status:${agentId}`, status);
}

/**
 * Build the stream-json user message payload string (without trailing newline).
 *
 * ```json
 * {"type":"user","message":{"role":"user","content":[{"type":"text","text":"…"}]}}
 * ```
 *
 * Images are prepended as base64 content blocks before the text block.
 */
function buildUserMessagePayload(
  text: string,
  images: Array<ImageAttachment>,
): string {
  const contentBlocks: string[] = [];

  for (const img of images) {
    const escapedMediaType = escapeJsonString(img.media_type);
    const escapedData = escapeJsonString(img.data);
    contentBlocks.push(
      `{"type":"image","source":{"type":"base64","media_type":"${escapedMediaType}","data":"${escapedData}"}}`,
    );
  }

  const escapedText = escapeJsonString(text);
  contentBlocks.push(`{"type":"text","text":"${escapedText}"}`);

  return `{"type":"user","message":{"role":"user","content":[${contentBlocks.join(",")}]}}`;
}

/**
 * Minimal JSON string escaper for embedding text in a JSON string literal.
 *
 * Handles all characters required to be escaped by the JSON specification.
 * Port of the Rust `escape_json_string` function in `stream.rs`.
 */
function escapeJsonString(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    const code = s.codePointAt(i)!;

    if (ch === '"') {
      out += '\\"';
    } else if (ch === "\\") {
      out += "\\\\";
    } else if (ch === "\n") {
      out += "\\n";
    } else if (ch === "\r") {
      out += "\\r";
    } else if (ch === "\t") {
      out += "\\t";
    } else if (code < 0x20) {
      // Control characters must be Unicode-escaped.
      out += `\\u${code.toString(16).padStart(4, "0")}`;
    } else {
      out += ch;
    }
  }
  return out;
}
