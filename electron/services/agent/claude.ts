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

import type {
  AgentInfo,
  AgentResult,
  AgentSession,
  AgentStatusValue,
} from "./models";
import type { ControlRequest, ControlResponse } from "./protocol";
import type {
  AndroidDeviceSession,
  BrowserSession,
  SimulatorReservation,
} from "../../state";
import type { RuntimePlatform } from "../workspace/models";
import { app } from "electron";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { promisify } from "node:util";
import { info, warn } from "../../../app/lib/logger";
import { getMainWindow } from "../../main";
import { appState } from "../../state";
import { webBrowserPool } from "../browser/pool";
import { getConductorSkillPath } from "../cli/conductorInstaller";
import { getMcpPort } from "../mcp/server";
import { simulatorPool } from "../simulator/pool";
import { incrementCommandMetric } from "../workspace/commandMetrics";
import { loadStagehandConfig } from "../workspace/setup";
import { ControlHandler } from "./controlHandler";

const execFileAsync = promisify(execFile);

/** The executable name used to invoke the Claude Code CLI. */
const CLAUDE_BIN = "claude";

// ---------------------------------------------------------------------------
// Lazy device helpers
// ---------------------------------------------------------------------------

/**
 * Ensure a simulator is reserved for the given agent, acquiring one on first
 * use. Returns the device UDID.
 */
export async function ensureSimulatorForAgent(
  agentId: string,
  repoRoot: string,
): Promise<string> {
  const existing = simulatorPool.getReservedUdid(agentId);
  if (existing) {
    return existing;
  }

  return simulatorPool.acquireSimulator(agentId, repoRoot);
}

/**
 * Ensure a web browser is reserved for the given agent, acquiring one on first
 * use. Returns the Conductor device ID (e.g. "web:chromium:a1b2c3d4").
 */
export async function ensureWebBrowserForAgent(
  agentId: string,
): Promise<string> {
  const existing = webBrowserPool.getReservation(agentId);
  if (existing) {
    return existing.deviceId;
  }

  const reservation = await webBrowserPool.acquireBrowser(agentId);

  return reservation.deviceId;
}

/**
 * Inject `--device {udid}` into a conductor CLI command string.
 * No-op if the command already contains `--device`.
 */
function injectDeviceFlag(command: string, udid: string): string {
  if (command.includes("--device")) {
    return command;
  }

  return command.replace(/\bconductor(\s+\S+)/, `conductor$1 --device ${udid}`);
}

/**
 * Lazily-loaded system prompts, one per workspace kind.
 * - Worktree agents: `worktree-agent-system-prompt.md`
 * - Root agents: `root-agent-system-prompt.md`
 */
const cachedPrompts: Record<string, string | null> = {
  worktree: null,
  repo_root: null,
  conductor: null,
};

function loadPromptFile(filename: string): string {
  try {
    const promptPath = app.isPackaged
      ? path.join(process.resourcesPath, filename)
      : path.join(process.cwd(), "electron", "prompts", filename);

    return readFileSync(promptPath, "utf-8");
  } catch (e) {
    warn(`Failed to load prompt ${filename}: ${String(e)}`);

    return "";
  }
}

function getSystemPromptForKind(kind: "repo_root" | "worktree"): string {
  if (cachedPrompts[kind] === null) {
    cachedPrompts[kind] =
      kind === "repo_root"
        ? loadPromptFile("root-agent-system-prompt.md")
        : loadPromptFile("worktree-agent-system-prompt.md");
  }

  return cachedPrompts[kind] ?? "";
}

function getConductorSkill(): string {
  if (cachedPrompts.conductor === null) {
    const skillPath = getConductorSkillPath();
    if (skillPath) {
      try {
        cachedPrompts.conductor = readFileSync(skillPath, "utf-8");
      } catch (e) {
        warn(`Failed to load conductor skill: ${String(e)}`);
        cachedPrompts.conductor = "";
      }
    } else {
      cachedPrompts.conductor = "";
    }
  }

  return cachedPrompts.conductor ?? "";
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
    if (typeof e === "string") {
      throw e;
    }
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
export async function startAgent(
  workspaceId: string,
  model?: string,
  permissionMode?: string,
  resumeSessionId?: string,
  appendSystemPrompt?: string,
  platformsOverride?: RuntimePlatform[],
  parentAgentId?: string,
): Promise<AgentInfo> {
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

  // Connect the agent to the Stagehand MCP server for workspace/agent
  // orchestration tools (create_workspace, spawn_agent, trigger_run, etc.).
  const mcpPort = getMcpPort();
  if (mcpPort) {
    const mcpConfig = JSON.stringify({
      mcpServers: {
        stagehand: { type: "http", url: `http://127.0.0.1:${mcpPort}/mcp` },
      },
    });
    args.push("--mcp-config", mcpConfig);
  }

  // Prepend ~/.stagehand/bin to PATH so the `conductor` CLI is available.
  const env = { ...process.env };
  const stagehandBin = path.join(os.homedir(), ".stagehand", "bin");
  env.PATH = `${stagehandBin}:${env.PATH ?? ""}`;

  // Devices (iOS simulator, headless Chromium) are acquired **lazily** by the
  // conductor shim the first time the agent runs `conductor --device ios|web`.
  // The shim resolves the device ID via an HTTP call to the Stagehand MCP
  // server using these env vars.
  env.STAGEHAND_AGENT_ID = agentId;
  if (mcpPort) {
    env.STAGEHAND_RESOLVER_URL = `http://127.0.0.1:${mcpPort}/stagehand/acquire-device`;
  }

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

  // Drain stderr and log each line. Forward to the renderer so auth errors
  // and other CLI diagnostics are visible in the conversation.
  child.stderr.on("data", (chunk: Buffer) => {
    const lines = chunk.toString().split("\n");
    for (const line of lines) {
      if (line.trim()) {
        warn(`[agent:${agentId}] stderr:`, line);
        emit(`agent:stderr:${agentId}`, line.trim());
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
    if (!line.trim()) {
      return;
    } // Skip blank separator lines.

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
          parsed as ControlResponse,
          emit,
        );
        if (consumed) {
          return;
        } // Don't forward consumed responses to renderer.
        // Fall through — forward unrecognised responses as raw events.
      }

      if (parsed.type === "control_request") {
        const req = parsed as ControlRequest;
        const payload = req.request;

        // Intercept conductor bash commands to transparently inject an
        // iOS/Android device UDID. (Web CDP injection lives in the conductor
        // shim at `~/.stagehand/bin/conductor` — it runs regardless of
        // permission mode, which matters because `bypassPermissions` skips
        // `can_use_tool` for auto-approved tools.)
        if (
          payload.subtype === "can_use_tool" &&
          payload.tool_name === "Bash"
        ) {
          const cmd = (payload.input?.command as string) ?? "";

          // iOS/Android: lazy simulator acquisition — inject --device {UDID}.
          if (cmd.includes("conductor") && !cmd.includes("--device")) {
            ensureSimulatorForAgent(agentId, workspace.repo_root)
              .then((udid) => {
                payload.input = {
                  ...payload.input,
                  command: injectDeviceFlag(cmd, udid),
                };
                const resp = controlHandler.handleControlRequest(req, emit);
                if (resp) {
                  stdin.write(resp + "\n");
                }
              })
              .catch((e) => {
                warn(
                  `[agent:${agentId}] simulator acquisition failed: ${String(e)}`,
                );
                // Fall through without injection.
                const resp = controlHandler.handleControlRequest(req, emit);
                if (resp) {
                  stdin.write(resp + "\n");
                }
              });

            return; // Async path handles the response.
          }
        }

        const autoResponse = controlHandler.handleControlRequest(req, emit);
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

    // Capture the final result event so orchestrator agents can retrieve it
    // via `get_agent_result` / `wait_for_agent` without parsing the stream.
    if (line.includes('"result"') && line.includes('"type"')) {
      try {
        const parsed = JSON.parse(line) as {
          type?: string;
          subtype?: string;
          result?: string;
          total_cost_usd?: number;
          duration_ms?: number;
        };
        if (parsed.type === "result") {
          const sess = appState.agents.get(agentId);
          if (sess) {
            sess.resultSummary = {
              subtype: (parsed.subtype as "error" | "success") ?? "success",
              result: parsed.result,
              total_cost_usd: parsed.total_cost_usd ?? 0,
              duration_ms: parsed.duration_ms ?? 0,
            };
          }
        }
      } catch {
        // Non-fatal — continue forwarding the line.
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

      // Notify anyone waiting on this agent (e.g. wait_for_agent callers).
      for (const resolve of session.exitWaiters) {
        resolve(exitCode);
      }
      session.exitWaiters.length = 0;
    }

    // Release device reservations (async, fire-and-forget).
    simulatorPool.releaseSimulator(agentId).catch((e) => {
      warn(`[agent:${agentId}] simulator release failed: ${String(e)}`);
    });
    webBrowserPool.releaseBrowser(agentId).catch((e) => {
      warn(`[agent:${agentId}] web browser release failed: ${String(e)}`);
    });

    getMainWindow()?.webContents.send(`agent:exit:${agentId}`, exitCode);
    info(`[agent:${agentId}] process exited with code ${exitCode}`);
  });

  const session: AgentSession = {
    agentId,
    workspaceId,
    stdin,
    child,
    status: "running",
    controlHandler,
    parentAgentId: parentAgentId ?? null,
    resultSummary: null,
    exitWaiters: [],
  };

  appState.agents.set(agentId, session);

  // Load project-level config from .stagehand.json (if present).
  let projectPrompt: string | null = null;
  let browserUrl: string | null = null;
  let configPlatforms: RuntimePlatform[] | null = null;
  try {
    const config = loadStagehandConfig(workspace.repo_root);
    projectPrompt = config.agent_prompt ?? null;
    browserUrl = config.browser_url ?? null;
    configPlatforms = config.platforms ?? null;
  } catch {
    // Config missing or invalid — non-fatal, skip project prompt.
  }

  // Resolve which runtime sections to emit: explicit override (from
  // spawn_agent) wins over `.stagehand.json`, which wins over the full
  // triple fallback.
  const resolvedPlatforms =
    platformsOverride && platformsOverride.length > 0
      ? platformsOverride
      : (configPlatforms ?? []);

  const runtimeSection = buildRuntimeSection({
    platforms: new Set(resolvedPlatforms),
    iosReservation: appState.simulatorReservations.get(agentId) ?? null,
    androidDevice: appState.androidDevice,
    browserSession: appState.browserSessions.get(workspaceId) ?? null,
    browserUrl,
  });

  // Combine prompts: kind-specific → project context → conductor skill → project-level → runtime → caller-provided.
  const systemPrompt = getSystemPromptForKind(workspace.kind);
  const conductorSkill = getConductorSkill();
  const projectContext = `## Current Project\n\nYou are working in **${workspace.repo_root}**. When using MCP tools that accept a \`repo_root\` parameter, always pass \`${workspace.repo_root}\` for work in this project. Use \`list_projects\` to discover paths for other projects.`;
  const combinedPrompt = [
    systemPrompt,
    projectContext,
    conductorSkill,
    projectPrompt,
    runtimeSection,
    appendSystemPrompt,
  ]
    .filter(Boolean)
    .join("\n\n");

  // Send an initialize control_request to discover capabilities (commands,
  // models, agents) without requiring a bootstrap user prompt.
  const initRequest = controlHandler.buildInitializeRequest(
    combinedPrompt || undefined,
  );
  stdin.write(initRequest + "\n");

  emitAgentStatus(agentId, "running");
  info(`[agent:${agentId}] started for workspace ${workspaceId}`);

  return {
    agent_id: agentId,
    workspace_id: workspaceId,
    status: "running",
    parent_agent_id: parentAgentId ?? null,
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
export async function stopAgent(agentId: string): Promise<void> {
  const session = appState.agents.get(agentId);
  if (!session) {
    throw `No agent found: ${agentId}`;
  }

  session.status = "stopped";

  try {
    session.child.kill();
  } catch (e) {
    // The process may have already exited; treat as non-fatal.
    info(`[agent:${agentId}] child.kill() returned: ${String(e)}`);
  }

  // Cleanup the control handler before removing the session.
  session.controlHandler?.cleanup();

  // Release device reservations and clean up.
  await simulatorPool.releaseSimulator(agentId);
  await webBrowserPool.releaseBrowser(agentId);

  appState.agents.delete(agentId);

  emitAgentStatus(agentId, "stopped");
  info(`[agent:${agentId}] stopped`);
}

// ---------------------------------------------------------------------------
// interrupt_agent
// ---------------------------------------------------------------------------

/**
 * Send an `interrupt` control request to the Claude Code CLI to stop the
 * current prompt without killing the agent. The process stays alive and
 * returns to an idle state, ready for the next message.
 *
 * @throws string if no agent is found or the CLI rejects the request.
 */
export async function interruptAgent(agentId: string): Promise<void> {
  const session = appState.agents.get(agentId);
  if (!session) {
    throw `No agent found: ${agentId}`;
  }
  if (session.status !== "running") {
    return;
  }

  const handler = session.controlHandler;
  if (!handler) {
    throw `Agent has no control handler: ${agentId}`;
  }

  const [json, promise] = handler.buildInterruptRequest();
  session.stdin.write(json + "\n");
  try {
    await promise;
  } catch (e) {
    throw `Failed to interrupt agent ${agentId}: ${String(e)}`;
  }

  info(`[agent:${agentId}] interrupted`);
}

// ---------------------------------------------------------------------------
// wait_for_agent
// ---------------------------------------------------------------------------

/**
 * Wait for an agent to exit, with an optional timeout.
 *
 * If the agent has already exited, resolves immediately. Otherwise registers
 * a callback on the session's `exitWaiters` list and returns a Promise.
 *
 * @returns The agent's final status and result summary.
 * @throws string if the agent is not found or the timeout expires.
 */
export function waitForAgent(
  agentId: string,
  timeoutMs?: number,
): Promise<{ status: AgentStatusValue; result: AgentResult | null }> {
  const session = appState.agents.get(agentId);
  if (!session) {
    throw `No agent found: ${agentId}`;
  }

  if (session.status === "stopped" || session.status === "error") {
    return Promise.resolve({
      status: session.status,
      result: session.resultSummary,
    });
  }

  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const onExit = (exitCode: number) => {
      if (timer) {
        clearTimeout(timer);
      }
      const finalSession = appState.agents.get(agentId);
      resolve({
        status: exitCode === 0 ? "stopped" : "error",
        result: finalSession?.resultSummary ?? null,
      });
    };

    session.exitWaiters.push(onExit);

    if (timeoutMs !== undefined && timeoutMs > 0) {
      timer = setTimeout(() => {
        const idx = session.exitWaiters.indexOf(onExit);
        if (idx !== -1) {
          session.exitWaiters.splice(idx, 1);
        }
        reject(`Timeout waiting for agent ${agentId} after ${timeoutMs}ms`);
      }, timeoutMs);
    }
  });
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
  images?: ImageAttachment[],
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
  if (!session) {
    throw `No agent found: ${agentId}`;
  }
  if (session.status !== "running") {
    throw `Agent is not running: ${agentId}`;
  }

  const handler = session.controlHandler;
  if (!handler) {
    throw `Agent has no control handler: ${agentId}`;
  }

  const [json, promise] = handler.buildSetModelRequest(model);
  session.stdin.write(json + "\n");
  await promise;

  getMainWindow()?.webContents.send(`agent:model-changed:${agentId}`, model);
  info(`[agent:${agentId}] model changed to ${model}`);
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
  if (!session) {
    throw `No agent found: ${agentId}`;
  }
  if (session.status !== "running") {
    throw `Agent is not running: ${agentId}`;
  }

  const handler = session.controlHandler;
  if (!handler) {
    throw `Agent has no control handler: ${agentId}`;
  }

  const [json, promise] = handler.buildSetPermissionModeRequest(mode);
  session.stdin.write(json + "\n");
  await promise;

  getMainWindow()?.webContents.send(
    `agent:permission-mode-changed:${agentId}`,
    mode,
  );
  info(`[agent:${agentId}] permission mode changed to ${mode}`);
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
        parent_agent_id: session.parentAgentId,
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
  denyMessage?: string,
): void {
  const session = appState.agents.get(agentId);
  if (!session) {
    throw `No agent found: ${agentId}`;
  }

  const handler = session.controlHandler;
  if (!handler) {
    throw `Agent has no control handler: ${agentId}`;
  }

  const response = handler.respond(
    toolUseId,
    decision,
    allowRule,
    allowAll,
    denyMessage,
  );

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
 * Context driving which runtime sections (iOS / Android / Web) are emitted
 * in the agent system prompt and which specifics (device UDID, booted
 * Android serial, live CDP session) are interpolated into them.
 */
interface RuntimeContext {
  platforms: Set<RuntimePlatform>;
  iosReservation: SimulatorReservation | null;
  androidDevice: AndroidDeviceSession | null;
  browserSession: BrowserSession | null;
  browserUrl: string | null;
}

/**
 * Build the "Runtime Environment" system prompt section, tailored to the
 * platforms this workspace actually targets and whatever devices are already
 * attached/reserved at agent start. Falls back to the full triple when
 * `.stagehand.json` does not declare `platforms`.
 */
function buildRuntimeSection(ctx: RuntimeContext): string {
  const {
    platforms,
    iosReservation,
    androidDevice,
    browserSession,
    browserUrl,
  } = ctx;
  const lines: string[] = [
    "## Runtime Environment",
    "",
    "You are running inside **Stagehand**, an agentic IDE. The user can see your code editor, a terminal, and one or more **runtime views** side by side. These runtime views show the live state of the app or website you are working on — the user is looking at them right now.",
  ];

  if (platforms.has("ios")) {
    lines.push("", "### iOS Simulator", "");
    if (iosReservation) {
      lines.push(
        `Your iOS simulator is **${iosReservation.deviceName}** (UDID \`${iosReservation.udid}\`) — reserved exclusively for this agent. Other parallel agents have their own separate simulators; never try to use theirs.`,
        "",
        "Conductor automatically targets your simulator when you run `conductor <cmd>` with no `--device` flag — do **not** call `conductor start-device` yourself.",
        "",
        `When you launch the app via a native tool that doesn't use conductor (e.g. \`pnpm ios\`, \`npx expo run:ios\`, \`xcrun simctl\`), you MUST target your simulator explicitly by name or UDID, otherwise it will install on whatever simulator happens to be booted first and collide with other agents. Examples:`,
        `- \`pnpm ios --device "${iosReservation.deviceName}"\``,
        `- \`xcrun simctl install ${iosReservation.udid} <path/to/app>\``,
        "",
        `The UDID is also available in your environment as \`$CONDUCTOR_IOS_DEVICE_ID\`.`,
      );
    } else {
      lines.push(
        "An iOS simulator is attached to your workspace. It will be provisioned automatically the first time you run a `conductor` command — do **not** call `conductor start-device` yourself.",
      );
    }
  }

  if (platforms.has("android")) {
    lines.push("", "### Android Emulator", "");
    if (androidDevice) {
      lines.push(
        `An Android ${androidDevice.type} **${androidDevice.deviceName}** (serial \`${androidDevice.serial}\`) is booted. Target it with \`conductor <command> --device ${androidDevice.serial}\`.`,
      );
    } else {
      lines.push(
        "An Android emulator may be available. Use `conductor list-devices` to check for booted Android devices. Conductor commands work the same way for Android — just target the Android device ID with `--device`.",
      );
    }
  }

  if (platforms.has("web")) {
    const browserDefault = browserUrl
      ? `, currently loaded at **${browserUrl}**`
      : "";
    const cdpNote = browserSession
      ? " A live CDP session is already wired to this workspace's webview."
      : "";
    lines.push(
      "",
      "### Web Browser",
      "",
      `A web browser view is attached to your workspace${browserDefault}.${cdpNote} The user can see this browser view in the runtime panel. When the user asks about "the website", "the page", or "what site we're on", they are referring to this web browser view.`,
      "",
      "To interact with the web browser view, use `conductor` with `--device web`:",
      "- `conductor inspect --device web` — see what's on the web page (ARIA tree, element names)",
      "- `conductor take-screenshot --device web` — capture the web browser view",
      '- `conductor tap-on "element" --device web` — click an element in the web page',
      '- `conductor input-text "text" --device web` — type text into the focused field',
      "- `conductor open-link <url> --device web` — navigate the web browser to a URL",
      "",
      "Stagehand wires `--device web` directly to this workspace's webview via CDP — conductor does **not** spawn a separate browser window. If the webview is reloaded or the runtime panel is torn down, run `conductor daemon-stop --device web` once to clear the stale connection; the next command will reconnect automatically.",
    );
  }

  lines.push("", "### Using conductor", "");
  lines.push(
    "Use the `conductor` CLI to interact with and observe all runtime views. Run `conductor cheat-sheet` for a quick command reference or `conductor --help` for full usage.",
    "",
    "Device targeting:",
  );
  if (platforms.has("ios")) {
    lines.push(
      '- **iOS simulator**: `conductor <command>` (no `--device` flag needed — auto-provisioned on first use). To target a specific booted device when multiple exist, use `--device-name "<name>"` (e.g. a reference simulator running a different build).',
    );
  }
  if (platforms.has("android")) {
    lines.push(
      "- **Android emulator**: `conductor <command> --device <android-id>` (run `conductor list-devices` to find the ID).",
    );
  }
  if (platforms.has("web")) {
    lines.push("- **Web browser**: `conductor <command> --device web`");
  }

  if (platforms.has("ios") || platforms.has("android")) {
    lines.push(
      "",
      "Common commands for mobile UI validation:",
      "- `conductor take-screenshot --output <path>` — capture the current screen (PNG). Read the file back to see it.",
      "- `conductor inspect` — print the accessibility tree (element IDs, labels, text) for the current screen.",
      '- `conductor tap-on "<element>"` — tap a visible element by text/accessibility label.',
      '- `conductor input-text "<text>"` — type into the focused text field.',
      "- `conductor swipe <direction>` / `conductor scroll <direction>` — navigate lists and scroll views.",
      "- `conductor foreground-app` — print the bundle ID / package name of the app currently in foreground.",
      '- `conductor assert-visible "<element>"` / `assert-not-visible "<element>"` — quick invariants for tests.',
      "- `conductor hide-keyboard` — dismiss the on-screen keyboard.",
      "",
      "When validating UI changes, screenshot the before/after state and compare. If the project has reference screenshots or a design spec (commonly under `legacy/`, `docs/`, or referenced in the project config), compare against those rather than relying on memory.",
    );
  }

  lines.push(
    "",
    "When the user asks about what they see, what's on screen, or what the app/website is showing, use conductor to answer from the device's current state.",
  );

  return lines.join("\n");
}

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
  images: ImageAttachment[],
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
