/**
 * Claude Code CLI subprocess management.
 *
 * Spawns `claude --print --output-format stream-json --input-format
 * stream-json --verbose --permission-prompt-tool stdio` as a child process
 * with piped stdin/stdout. A `readline` interface drains stdout line by line.
 *
 * Lines containing `control_request` or `control_cancel_request` are parsed
 * in the backend and handled by {@link ControlHandler}. Everything else is
 * forwarded as raw JSON strings to the renderer via IPC.
 *
 * # Event contract
 *
 * | IPC channel                          | Payload                        |
 * |--------------------------------------|--------------------------------|
 * | `agent:event:{agentId}`              | Raw JSON string (one per line) |
 * | `agent:exit:{agentId}`               | Exit code (number)             |
 * | `agent:status:{agentId}`             | Status string                  |
 * | `agent:permission:{agentId}`         | PermissionRequestPayload       |
 * | `agent:permission-cancel:{agentId}`  | PermissionCancelPayload        |
 *
 * # Input contract
 *
 * User messages are written to the child's stdin as a single JSON line:
 * ```json
 * {"type":"user","message":{"role":"user","content":[{"type":"text","text":"…"}]}}
 * ```
 *
 * Permission responses are written as `control_response` JSON lines.
 */

import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import readline from "node:readline";
import { app } from "electron";

import { getMainWindow } from "../../main";
import { appState } from "../../state";
import type { AgentInfo, AgentSession, AgentStatusValue } from "./models";
import { ControlHandler } from "./controlHandler";
import { incrementCommandMetric } from "../workspace/commandMetrics";
import { loadStagehandConfig } from "../workspace/setup";

const execFileAsync = promisify(execFile);

/** The executable name used to invoke the Claude Code CLI. */
const CLAUDE_BIN = "claude";

/**
 * Lazily-loaded system prompts, one per workspace kind.
 * - Worktree agents: `worktree-agent-system-prompt.md`
 * - Root agents: `root-agent-system-prompt.md`
 */
const cachedPrompts: Record<string, string | null> = {
  worktree: null,
  repo_root: null,
};

function loadPromptFile(filename: string): string {
  try {
    const promptPath = app.isPackaged
      ? path.join(process.resourcesPath, filename)
      : path.join(process.cwd(), "electron", "prompts", filename);
    return readFileSync(promptPath, "utf-8");
  } catch (e) {
    console.warn(`Failed to load prompt ${filename}: ${String(e)}`);
    return "";
  }
}

function getSystemPromptForKind(kind: "worktree" | "repo_root"): string {
  if (cachedPrompts[kind] === null) {
    cachedPrompts[kind] =
      kind === "repo_root"
        ? loadPromptFile("root-agent-system-prompt.md")
        : loadPromptFile("worktree-agent-system-prompt.md");
  }
  return cachedPrompts[kind] ?? "";
}

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
 * renderer receives structured JSON events. Permission prompts are handled
 * natively via the `--permission-prompt-tool stdio` flag — the CLI sends
 * `control_request` messages on stdout and expects `control_response`
 * messages on stdin.
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
  appendSystemPrompt?: string,
): AgentInfo {
  // Verify the workspace exists and grab its path.
  const workspace = appState.workspaces.get(workspaceId);
  if (!workspace) {
    throw `Workspace not found: ${workspaceId}`;
  }
  const worktreePath = workspace.path;

  const agentId = crypto.randomUUID();

  // Create the control handler for permission management.
  const controlHandler = new ControlHandler(agentId);

  // Build CLI args.
  const args: string[] = [
    "--print",
    "--output-format",
    "stream-json",
    "--input-format",
    "stream-json",
    "--verbose",
    "--permission-prompt-tool",
    "stdio",
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

  // Prepend ~/.stagehand/bin to PATH so the `stagehand` CLI is available.
  const env = { ...process.env };
  const stagehandBin = path.join(os.homedir(), ".stagehand", "bin");
  env.PATH = `${stagehandBin}:${env.PATH ?? ""}`;

  const child = spawn(CLAUDE_BIN, args, {
    cwd: worktreePath,
    stdio: ["pipe", "pipe", "pipe"],
    // Inherit the current process environment (with stagehand bin prepended)
    // so PATH, HOME, and any API keys are available to the child.
    env,
  });

  if (!child.stdin || !child.stdout || !child.stderr) {
    controlHandler.cleanup();
    throw `Failed to acquire stdio pipes for agent ${agentId}`;
  }

  const stdin = child.stdin;

  // Drain stderr and log each line.
  child.stderr.on("data", (chunk: Buffer) => {
    const lines = chunk.toString().split("\n");
    for (const line of lines) {
      if (line.trim()) {
        console.warn(`[agent:${agentId}] stderr:`, line);
      }
    }
  });

  // Helper to emit IPC events to the renderer.
  const emit = (channel: string, data: unknown): void => {
    getMainWindow()?.webContents.send(channel, data);
  };

  // Drain stdout line by line.
  const rl = readline.createInterface({
    input: child.stdout,
    crlfDelay: Infinity,
  });

  const eventChannel = `agent:event:${agentId}`;

  rl.on("line", (line) => {
    if (!line.trim()) return; // Skip blank separator lines.

    // Fast-path check: only parse lines that look like control messages.
    // Most lines are assistant/user/result/system events and can be forwarded
    // as raw strings without parsing, keeping the backend lightweight.
    if (
      line.includes('"control_request"') ||
      line.includes('"control_cancel_request"') ||
      line.includes('"control_response"')
    ) {
      let parsed: {
        type: string;
        request_id?: string;
        request?: unknown;
        response?: {
          request_id?: string;
          subtype?: string;
          response?: unknown;
          error?: string;
        };
      };
      try {
        parsed = JSON.parse(line);
      } catch {
        // Malformed line — forward to renderer and let it deal with it.
        emit(eventChannel, line);
        return;
      }

      if (parsed.type === "control_response") {
        // Response to a control_request we sent (e.g. initialize).
        const consumed = controlHandler.handleControlResponse(
          parsed as import("./protocol").ControlResponse,
          emit,
        );
        if (consumed) return; // Don't forward consumed responses to renderer.
        // Fall through — forward unrecognised responses as raw events.
      }

      if (parsed.type === "control_request") {
        const autoResponse = controlHandler.handleControlRequest(
          parsed as import("./protocol").ControlRequest,
          emit,
        );
        if (autoResponse) {
          stdin.write(autoResponse + "\n");
        }
        return; // Don't forward control_requests to renderer.
      }

      if (parsed.type === "control_cancel_request") {
        controlHandler.cancelRequest(parsed.request_id ?? "", emit);
        return; // Don't forward cancel requests to renderer.
      }
    }

    // Forward everything else to renderer as raw JSON string.
    emit(eventChannel, line);
  });

  // When the process exits update agent status and emit the exit event.
  child.on("close", (code) => {
    const exitCode = code ?? 0;

    const session = appState.agents.get(agentId);
    if (session) {
      session.status = exitCode === 0 ? "stopped" : "error";
    }

    getMainWindow()?.webContents.send(`agent:exit:${agentId}`, exitCode);
    console.info(`[agent:${agentId}] process exited with code ${exitCode}`);
  });

  const session: AgentSession = {
    agentId,
    workspaceId,
    stdin,
    child,
    status: "running",
    controlHandler,
  };

  appState.agents.set(agentId, session);

  // Load project-level agent prompt from .stagehand.json (if present).
  let projectPrompt: string | null = null;
  try {
    const config = loadStagehandConfig(workspace.repo_root);
    projectPrompt = config.agent_prompt ?? null;
  } catch {
    // Config missing or invalid — non-fatal, skip project prompt.
  }

  // Combine prompts: kind-specific → project-level → caller-provided.
  const systemPrompt = getSystemPromptForKind(workspace.kind);
  const combinedPrompt = [systemPrompt, projectPrompt, appendSystemPrompt]
    .filter(Boolean)
    .join("\n\n");

  // Send an initialize control_request to discover capabilities (commands,
  // models, agents) without requiring a bootstrap user prompt.
  const initRequest = controlHandler.buildInitializeRequest(
    combinedPrompt || undefined,
  );
  stdin.write(initRequest + "\n");

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
    console.info(`[agent:${agentId}] child.kill() returned: ${String(e)}`);
  }

  // Cleanup the control handler before removing the session.
  session.controlHandler?.cleanup();

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

  // Track slash command usage for autocomplete sorting.
  const trimmed = message.trim();
  if (trimmed.startsWith("/")) {
    const cmdName = trimmed.slice(1).split(/\s+/)[0];
    if (cmdName) {
      const workspace = appState.workspaces.get(session.workspaceId);
      if (workspace?.repo_root) {
        incrementCommandMetric(workspace.repo_root, cmdName);
      }
    }
  }

  const payload = buildUserMessagePayload(message, images ?? []);

  try {
    session.stdin.write(payload + "\n");
  } catch (e) {
    throw `Failed to write to agent stdin: ${String(e)}`;
  }
}

// ---------------------------------------------------------------------------
// set_agent_model
// ---------------------------------------------------------------------------

/**
 * Change the model for an active agent session via the control protocol.
 *
 * Sends a `set_model` control request to the CLI and awaits the response.
 * The model change takes effect on the next conversation turn without
 * restarting the process.
 *
 * @throws string if no agent is found or the CLI rejects the request.
 */
export async function setAgentModel(
  agentId: string,
  model: string,
): Promise<void> {
  const session = appState.agents.get(agentId);
  if (!session) throw `No agent found: ${agentId}`;
  if (session.status !== "running") throw `Agent is not running: ${agentId}`;

  const handler = session.controlHandler;
  if (!handler) throw `Agent has no control handler: ${agentId}`;

  const [json, promise] = handler.buildSetModelRequest(model);
  session.stdin.write(json + "\n");
  await promise;

  getMainWindow()?.webContents.send(`agent:model-changed:${agentId}`, model);
  console.info(`[agent:${agentId}] model changed to ${model}`);
}

// ---------------------------------------------------------------------------
// set_agent_permission_mode
// ---------------------------------------------------------------------------

/**
 * Change the permission mode for an active agent session via the control
 * protocol (e.g. switching to/from plan mode).
 *
 * Sends a `set_permission_mode` control request to the CLI and awaits the
 * response. The mode change applies immediately without restarting.
 *
 * @throws string if no agent is found or the CLI rejects the request.
 */
export async function setAgentPermissionMode(
  agentId: string,
  mode: string,
): Promise<void> {
  const session = appState.agents.get(agentId);
  if (!session) throw `No agent found: ${agentId}`;
  if (session.status !== "running") throw `Agent is not running: ${agentId}`;

  const handler = session.controlHandler;
  if (!handler) throw `Agent has no control handler: ${agentId}`;

  const [json, promise] = handler.buildSetPermissionModeRequest(mode);
  session.stdin.write(json + "\n");
  await promise;

  getMainWindow()?.webContents.send(
    `agent:permission-mode-changed:${agentId}`,
    mode,
  );
  console.info(`[agent:${agentId}] permission mode changed to ${mode}`);
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
 * Respond to a pending permission request via the control protocol.
 *
 * Builds a `control_response` and writes it to the CLI's stdin.
 *
 * `decision` must be `"allow"` or `"deny"`.
 * `allowRule` is a Claude CLI-style rule like `Bash(npm *)` or
 * `Edit(**\/*.tsx)`. Only registered when `allowAll` is true.
 *
 * @throws string if no agent, control handler, or pending request is found.
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

  const handler = session.controlHandler;
  if (!handler) {
    throw `Agent has no control handler: ${agentId}`;
  }

  const response = handler.respond(toolUseId, decision, allowRule, allowAll);

  try {
    session.stdin.write(response + "\n");
  } catch (e) {
    throw `Failed to write permission response to agent stdin: ${String(e)}`;
  }
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
