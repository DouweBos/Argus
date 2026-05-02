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
import type { RuntimePlatform } from "../session/models";
import { app } from "electron";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { promisify } from "node:util";
import { info, warn } from "../../../app/lib/logger";
import { broadcastToRenderers } from "../../broadcast";
import { appState } from "../../state";
import { webBrowserPool } from "../browser/pool";
import { getConductorBinDir, getConductorSkillPath } from "../cli/conductor";
import { getMcpAuthToken, getMcpPort } from "../mcp/server";
import { buildMergedMcpServers } from "../mcp/userConfig";
import { organizationsForRepo } from "../organization/manager";
import { findOrgTaskForSession } from "../organizationTask/manager";
import { incrementCommandMetric } from "../session/commandMetrics";
import { emitReviewState } from "../session/sessionOps";
import { loadArgusConfig } from "../session/setup";
import { simulatorPool } from "../simulator/pool";
import { capture as telemetryCapture } from "../telemetry/telemetry";
import { injectDeviceFlag, isConductorInvocation } from "./conductorInjection";
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
 * Lazily-loaded system prompts, one per session kind.
 * - Worktree agents: `worktree-agent-system-prompt.md`
 * - Root agents: `root-agent-system-prompt.md`
 */
const cachedPrompts: Record<string, string | null> = {
  worktree: null,
  repo_root: null,
  org_host: null,
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

function getSystemPromptForKind(
  kind: "org_host" | "project_root" | "worktree",
): string {
  if (cachedPrompts[kind] === null) {
    if (kind === "project_root") {
      cachedPrompts[kind] = loadPromptFile("root-agent-system-prompt.md");
    } else if (kind === "org_host") {
      cachedPrompts[kind] = loadPromptFile("org-host-agent-system-prompt.md");
    } else {
      cachedPrompts[kind] = loadPromptFile("worktree-agent-system-prompt.md");
    }
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

/**
 * Build the organization-context prompt section for agents spawned in
 * `repoRoot`. Lists each organization this repo belongs to, the org's system
 * prompt, and the roles of sibling member repos so the agent understands the
 * wider product. Returns an empty string if the repo isn't part of any org.
 */
function buildOrganizationContext(repoRoot: string, sessionId: string): string {
  const task = findOrgTaskForSession(sessionId);
  // For org_host sessions repo_root is the neutral dir, so look up the org
  // via the task itself. For normal sessions, fall back to repo membership.
  const taskOrg = task
    ? (appState.organizations.get(task.organization_id) ?? null)
    : null;
  const orgs = taskOrg ? [taskOrg] : organizationsForRepo(repoRoot);
  if (orgs.length === 0) {
    return "";
  }

  const sections = orgs.map((org) => {
    const lines: string[] = [`### Organization: ${org.name}`];
    if (org.description) {
      lines.push(org.description);
    }
    if (org.system_prompt) {
      lines.push("", org.system_prompt);
    }
    lines.push("", "**Member repos:**");
    for (const m of org.members) {
      const marker = m.repo_root === repoRoot ? " _(this repo)_" : "";
      const role = m.role || "(no role described)";
      lines.push(`- \`${m.repo_root}\` — ${role}${marker}`);
    }
    lines.push(
      "",
      "Use `spawn_agent` with a member's `project_path` to delegate work to the project responsible for that slice of the product.",
    );

    return lines.join("\n");
  });

  let base = `## Organization Context\n\n${sections.join("\n\n")}`;

  // If this session is the host of a cross-repo OrgTask, surface the task
  // so the agent has it in context after restarts. Host-only — child worktrees
  // inherit context from their parent's spawn prompt.
  if (task) {
    const scopeLines = task.scope
      .map((s) => `- \`${s.repo_root}\` — ${s.role || "(no role described)"}`)
      .join("\n");
    const taskLines: string[] = [
      "",
      "## Current Cross-Repo Task",
      "",
      `**Task:** ${task.title}`,
      "",
      "**Shared prompt:**",
      "",
      task.prompt,
      "",
      "**In-scope repos:**",
      "",
      scopeLines,
    ];

    base += "\n" + taskLines.join("\n");
  }

  return base;
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
 * Spawn a new `claude` CLI process for the given session.
 *
 * Claude is started in `--output-format stream-json` mode so that the
 * renderer receives structured JSON events. Permission prompts are handled
 * natively via the `--permission-prompt-tool stdio` flag — the CLI sends
 * `control_request` messages on stdout and expects `control_response`
 * messages on stdin.
 *
 * Returns an {@link AgentInfo} containing the generated `agentId`.
 *
 * @throws string if the session is not found or the process cannot be
 *   spawned.
 */
export async function startAgent(
  sessionId: string,
  model?: string,
  permissionMode?: string,
  resumeSessionId?: string,
  appendSystemPrompt?: string,
  platformsOverride?: RuntimePlatform[],
  parentAgentId?: string,
  reuseAgentId?: string,
  /**
   * Optional id to assign to a *fresh* agent (e.g. one minted by the
   * renderer for optimistic UI). Unlike `reuseAgentId`, this does NOT
   * imply a respawn: no previous slot is looked up and the
   * `agent_started` telemetry event still fires.
   */
  presetAgentId?: string,
): Promise<AgentInfo> {
  // Verify the session exists and grab its path.
  const argusSession = appState.sessions.get(sessionId);
  if (!argusSession) {
    throw `Session not found: ${sessionId}`;
  }
  // Pending sessions have no worktree yet — spawning Claude with `cwd: ""`
  // would silently land in the Argus app's own working directory. The
  // frontend's `pendingSessionPrompts` waits for `ready`; this guard
  // protects MCP / IPC entry points that don't.
  if (!argusSession.path) {
    throw `Session ${sessionId} is still initializing`;
  }
  // The on-disk working directory can disappear between session creation and
  // agent spawn — most commonly for org_host sessions whose host dir was
  // pruned by a stale-task cleanup (e.g. another Argus instance running
  // `initOrgTasks`). Without this guard `spawn` fails with a confusing
  // `ENOENT` that points at the binary, the optimistic agent gets removed,
  // and the new-agent tab appears to vanish on click.
  if (!existsSync(argusSession.path)) {
    appState.sessions.delete(sessionId);
    broadcastToRenderers("session:deleted", sessionId);
    throw `Session working directory no longer exists: ${argusSession.path}`;
  }
  const worktreePath = argusSession.path;

  // When `reuseAgentId` is set we're respawning the child under an existing
  // slot (e.g. restore-at-turn). Keep the same id so frontend listeners,
  // conversation state, and UI tabs stay bound — no swap needed.
  // `presetAgentId` carries a renderer-minted id for optimistic UI on a
  // fresh agent (no respawn semantics).
  const agentId = reuseAgentId ?? presetAgentId ?? crypto.randomUUID();

  // Resolve the effective model: explicit arg wins, otherwise carry over the
  // previous slot's model on respawn. The carry-over matters for variants
  // like `claude-opus-4-7[1m]` whose suffix isn't echoed in the JSONL — if
  // we re-spawn without `--model`, the CLI silently drops back to the 200K
  // default and the next turn blows the context window.
  const previousAgentForModel = reuseAgentId
    ? appState.agents.get(reuseAgentId)
    : null;
  const effectiveModel = model ?? previousAgentForModel?.model ?? null;

  // Create the control handler for permission management.
  const controlHandler = new ControlHandler(agentId);

  // Per-agent debug log — full Claude Code internal trace written to
  // `~/.argus/agents/<agentId>.debug.log`. Used to diagnose filesystem
  // access / TCC prompts triggered on agent spawn.
  const agentLogsDir = path.join(os.homedir(), ".argus", "agents");
  mkdirSync(agentLogsDir, { recursive: true });
  const debugLogPath = path.join(agentLogsDir, `${agentId}.debug.log`);

  // Build CLI args.
  const args: string[] = [
    "--print",
    "--output-format",
    "stream-json",
    "--input-format",
    "stream-json",
    "--verbose",
    "--debug-file",
    debugLogPath,
    "--permission-prompt-tool",
    "stdio",
  ];

  if (effectiveModel) {
    args.push("--model", effectiveModel);
  }
  if (permissionMode) {
    args.push("--permission-mode", permissionMode);
  }
  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
  }

  // Connect the agent to the Argus MCP server for session/agent
  // orchestration tools (create_session, spawn_agent, trigger_run, etc.).
  // The per-launch bearer token is required on every request — only spawned
  // children learn it, so other local processes can't reach the server.
  const mcpPort = getMcpPort();
  const mcpToken = getMcpAuthToken();
  if (mcpPort && mcpToken) {
    const mcpServers = await buildMergedMcpServers(worktreePath, {
      argus: {
        type: "http",
        url: `http://127.0.0.1:${mcpPort}/mcp`,
        headers: { Authorization: `Bearer ${mcpToken}` },
      },
    });
    args.push("--mcp-config", JSON.stringify({ mcpServers }));
  }

  // Prepend the bundled conductor shim dir to PATH so agents can run
  // `conductor` directly and it routes through our Argus-aware wrapper.
  const env = { ...process.env };
  env.PATH = `${getConductorBinDir()}:${env.PATH ?? ""}`;

  // Devices (iOS simulator, headless Chromium) are acquired **lazily** by the
  // conductor shim the first time the agent runs `conductor --device ios|web`.
  // The shim resolves the device ID via an HTTP call to the Argus MCP
  // server using these env vars.
  env.ARGUS_AGENT_ID = agentId;
  if (mcpPort && mcpToken) {
    env.ARGUS_RESOLVER_URL = `http://127.0.0.1:${mcpPort}/argus/acquire-device`;
    env.ARGUS_RESOLVER_TOKEN = mcpToken;
  }

  // Disable the Claude CLI's default per-tool MCP call timeout (~60s). Argus
  // tools like `wait_for_agent` and `send_agent_message` legitimately block
  // for minutes-to-hours; without this, the CLI's MCP client aborts the HTTP
  // request mid-wait, the server-side promise resolves into a dead socket,
  // and the caller never learns the child finished. 24h cap = effectively off.
  env.MCP_TOOL_TIMEOUT = "86400000";
  env.MCP_TIMEOUT = env.MCP_TIMEOUT ?? "30000";

  const child = spawn(CLAUDE_BIN, args, {
    cwd: worktreePath,
    stdio: ["pipe", "pipe", "pipe"],
    // Inherit the current process environment (with argus bin prepended)
    // so PATH, HOME, and any API keys are available to the child.
    env,
  });

  info(`[agent:${agentId}] debug log: ${debugLogPath}`);

  if (!child.stdin || !child.stdout || !child.stderr) {
    controlHandler.cleanup();
    throw `Failed to acquire stdio pipes for agent ${agentId}`;
  }

  const stdin = child.stdin;

  // Attach error handlers to all stdio pipes. Without these, an EPIPE on a
  // write after the child has been killed becomes an uncaughtException, which
  // Electron surfaces as a JS error dialog in packaged builds. Logging is
  // sufficient — the `close` handler below drives real lifecycle updates.
  stdin.on("error", (err) => {
    info(`[agent:${agentId}] stdin error: ${String(err)}`);
  });
  child.stdout.on("error", (err) => {
    info(`[agent:${agentId}] stdout error: ${String(err)}`);
  });
  child.stderr.on("error", (err) => {
    info(`[agent:${agentId}] stderr error: ${String(err)}`);
  });
  child.on("error", (err) => {
    warn(`[agent:${agentId}] child process error: ${String(err)}`);
  });

  // Guarded write helper — silently drops writes once the session is stopped
  // or the stdin pipe has been destroyed. Prevents race conditions where
  // buffered stdout lines trigger control responses after `stopAgent` killed
  // the process.
  const safeWrite = (data: string): void => {
    const current = appState.agents.get(agentId);
    if (
      !current ||
      current.status === "stopped" ||
      current.status === "error"
    ) {
      return;
    }
    if (stdin.destroyed || stdin.writableEnded) {
      return;
    }
    try {
      stdin.write(data);
    } catch (e) {
      info(`[agent:${agentId}] stdin write failed: ${String(e)}`);
    }
  };

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

  // Helper to emit IPC events to every renderer — main window plus any agent
  // popouts that subscribe to this agent's stream.
  const emit = (channel: string, data: unknown): void => {
    broadcastToRenderers(channel, data);
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

    // Cheap heartbeat: bump last-activity on every non-blank event so
    // `agent_vitals` can answer "is this child stuck?" without parsing
    // the transcript.
    const sessForActivity = appState.agents.get(agentId);
    if (sessForActivity) {
      sessForActivity.lastEventAt = Date.now();

      // Tool-use heartbeat: increment counter and stamp "last tool" when an
      // assistant message contains a tool_use content block. Cheap substring
      // gate first to keep the hot path fast for non-tool events.
      if (line.includes('"type":"tool_use"')) {
        try {
          const parsed = JSON.parse(line) as {
            type?: string;
            message?: {
              content?: { type?: string; name?: string }[];
            };
          };
          if (parsed.type === "assistant") {
            const blocks = parsed.message?.content ?? [];
            let observed = 0;
            let latestName: string | null = null;
            for (const block of blocks) {
              if (block.type === "tool_use") {
                observed += 1;
                if (typeof block.name === "string") {
                  latestName = block.name;
                }
              }
            }
            if (observed > 0) {
              sessForActivity.toolUsesTotal += observed;
              sessForActivity.lastToolUseAt = Date.now();
              if (latestName !== null) {
                sessForActivity.lastToolName = latestName;
              }
            }
          }
        } catch {
          // Malformed line — already forwarded elsewhere; drop the metric.
        }
      }
    }

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
        // iOS/Android device UDID. (Web CDP injection lives in the bundled
        // conductor shim — it runs regardless of permission mode, which
        // matters because `bypassPermissions` skips
        // `can_use_tool` for auto-approved tools.)
        if (
          payload.subtype === "can_use_tool" &&
          payload.tool_name === "Bash"
        ) {
          const cmd = (payload.input?.command as string) ?? "";

          // iOS/Android: lazy simulator acquisition — inject --device {UDID}.
          // Gate strictly on a real conductor CLI invocation so unrelated
          // commands that merely mention the word "conductor" (e.g. a git
          // operation against the conductor repo) don't trigger acquisition
          // and don't get the flag spliced into them.
          if (isConductorInvocation(cmd) && !cmd.includes("--device")) {
            const respondWith = (rewrittenCmd: string | null) => {
              if (rewrittenCmd !== null) {
                payload.input = { ...payload.input, command: rewrittenCmd };
              }
              const resp = controlHandler.handleControlRequest(req, emit);
              if (resp) {
                safeWrite(resp + "\n");
              }
            };

            // Bound the wait so a stalled simulator pool can't wedge the
            // tool-approval channel (and therefore `wait_for_agent`) forever.
            const SIM_ACQUIRE_TIMEOUT_MS = 60_000;
            let settled = false;
            const timer = setTimeout(() => {
              if (settled) {
                return;
              }
              settled = true;
              warn(
                `[agent:${agentId}] simulator acquisition timed out after ${SIM_ACQUIRE_TIMEOUT_MS}ms — running command without --device`,
              );
              respondWith(null);
            }, SIM_ACQUIRE_TIMEOUT_MS);

            ensureSimulatorForAgent(agentId, argusSession.repo_root)
              .then((udid) => {
                if (settled) {
                  return;
                }
                settled = true;
                clearTimeout(timer);
                respondWith(injectDeviceFlag(cmd, udid));
              })
              .catch((e) => {
                if (settled) {
                  return;
                }
                settled = true;
                clearTimeout(timer);
                warn(
                  `[agent:${agentId}] simulator acquisition failed: ${String(e)}`,
                );
                respondWith(null);
              });

            return; // Async path handles the response.
          }
        }

        const autoResponse = controlHandler.handleControlRequest(req, emit);
        if (autoResponse) {
          safeWrite(autoResponse + "\n");
        }

        return; // Don't forward control_requests to renderer.
      }

      if (parsed.type === "control_cancel_request") {
        controlHandler.cancelRequest(parsed.request_id ?? "", emit);

        return; // Don't forward cancel requests to renderer.
      }
    }

    // Track idle/running transitions from the CLI's authoritative
    // `session_state_changed` event. The child process stays alive between
    // turns, so process liveness is *not* a good signal for "agent finished
    // its turn" — this event is.
    if (line.includes('"session_state_changed"')) {
      try {
        const parsed = JSON.parse(line) as {
          type?: string;
          subtype?: string;
          state?: string;
        };
        if (
          parsed.type === "system" &&
          parsed.subtype === "session_state_changed"
        ) {
          const sess = appState.agents.get(agentId);
          if (
            sess &&
            sess.status !== "stopped" &&
            sess.status !== "error" &&
            (parsed.state === "idle" ||
              parsed.state === "running" ||
              parsed.state === "requires_action")
          ) {
            const prev = sess.status;
            sess.status = parsed.state;
            if (prev !== parsed.state) {
              emitAgentStatus(agentId, parsed.state);
            }
            if (parsed.state === "idle" && prev !== "idle") {
              sess.turnsCompleted += 1;
              // Notify anyone waiting on turn completion.
              for (const resolve of sess.turnWaiters) {
                resolve("idle");
              }
              sess.turnWaiters.length = 0;
            }
          }
        }
      } catch {
        // Non-fatal — fall through to forward the line.
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
            if (sess.inflightPrompts > 0) {
              sess.inflightPrompts -= 1;
            }
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

    // Reject any in-flight control requests (including initialize) so callers
    // that are `await`ing don't hang forever on an exited child.
    controlHandler.cleanup();

    const agentEntry = appState.agents.get(agentId);
    // If the slot was reused by a respawn (restore-at-turn), this `child` is
    // the abandoned old process. Silently drop its close event so the
    // frontend doesn't see spurious exit/stopped transitions.
    if (agentEntry && agentEntry.child !== child) {
      info(`[agent:${agentId}] old child closed after respawn — ignored`);

      return;
    }
    if (agentEntry) {
      agentEntry.status = exitCode === 0 ? "stopped" : "error";

      // Notify anyone waiting on this agent (e.g. wait_for_agent callers).
      for (const resolve of agentEntry.exitWaiters) {
        resolve(exitCode);
      }
      agentEntry.exitWaiters.length = 0;

      // Also unblock anyone waiting on turn completion — process exit
      // implicitly ends any in-flight turn.
      for (const resolve of agentEntry.turnWaiters) {
        resolve(agentEntry.status);
      }
      agentEntry.turnWaiters.length = 0;
    }

    // Release device reservations (async, fire-and-forget).
    simulatorPool.releaseSimulator(agentId).catch((e) => {
      warn(`[agent:${agentId}] simulator release failed: ${String(e)}`);
    });
    webBrowserPool.releaseBrowser(agentId).catch((e) => {
      warn(`[agent:${agentId}] web browser release failed: ${String(e)}`);
    });

    broadcastToRenderers(`agent:exit:${agentId}`, exitCode);
    info(`[agent:${agentId}] process exited with code ${exitCode}`);

    if (agentEntry) {
      telemetryCapture("agent_exited", {
        exit_code: exitCode,
        success: exitCode === 0,
        turns_completed: agentEntry.turnsCompleted,
        tool_uses: agentEntry.toolUsesTotal,
        duration_ms: Date.now() - agentEntry.createdAt,
      });
    }

    // Re-evaluate whether this session now has reviewable changes.
    emitReviewState(sessionId).catch(() => {});
  });

  // Start as idle — the process is alive but hasn't been given work yet.
  // The CLI will emit `session_state_changed` → `running` when the initialize
  // request or any user message triggers a turn, and flip back to idle when
  // it finishes. Tracking idle/running accurately matters for the quit
  // confirmation dialog, which should only block on agents doing real work.
  // On respawn, carry the old slot's `suppressStatus` flag — the caller
  // (e.g. restoreAgentAtTurn) sets it before the kill so the window from
  // kill → new-child-ready stays silent on the status channel.
  const previous = reuseAgentId ? appState.agents.get(reuseAgentId) : null;
  const agentSession: AgentSession = {
    agentId,
    sessionId,
    stdin,
    child,
    status: "idle",
    controlHandler,
    parentAgentId: parentAgentId ?? null,
    resultSummary: null,
    exitWaiters: [],
    turnWaiters: [],
    turnsCompleted: previous?.turnsCompleted ?? 0,
    suppressStatus: previous?.suppressStatus ?? false,
    createdAt: previous?.createdAt ?? Date.now(),
    lastEventAt: Date.now(),
    toolUsesTotal: previous?.toolUsesTotal ?? 0,
    lastToolUseAt: previous?.lastToolUseAt ?? null,
    lastToolName: previous?.lastToolName ?? null,
    // Reset on respawn — the prior child's in-flight prompt is abandoned, and
    // restoreAgentAtTurn writes a fresh user message which increments this
    // again via sendAgentMessage.
    inflightPrompts: 0,
    model: effectiveModel,
  };

  appState.agents.set(agentId, agentSession);

  if (!reuseAgentId) {
    telemetryCapture("agent_started", {
      has_model: Boolean(model),
      has_resume_id: Boolean(resumeSessionId),
      has_parent: Boolean(parentAgentId),
      permission_mode: permissionMode ?? "default",
      session_kind: argusSession.kind,
    });
  }

  // Load project-level config from .argus.json (if present).
  let projectPrompt: string | null = null;
  let browserUrl: string | null = null;
  let configPlatforms: RuntimePlatform[] | null = null;
  try {
    const config = loadArgusConfig(argusSession.repo_root);
    projectPrompt = config.agent_prompt ?? null;
    browserUrl = config.browser_url ?? null;
    configPlatforms = config.platforms ?? null;
  } catch {
    // Config missing or invalid — non-fatal, skip project prompt.
  }

  // Resolve which runtime sections to emit: explicit override (from
  // spawn_agent) wins over `.argus.json`, which wins over the full
  // triple fallback.
  const resolvedPlatforms =
    platformsOverride && platformsOverride.length > 0
      ? platformsOverride
      : (configPlatforms ?? []);

  const runtimeSection = buildRuntimeSection({
    platforms: new Set(resolvedPlatforms),
    iosReservation: appState.simulatorReservations.get(agentId) ?? null,
    androidDevice: appState.androidDevice,
    browserSession: appState.browserSessions.get(sessionId) ?? null,
    browserUrl,
  });

  // Combine prompts: kind-specific → project context → org context → conductor skill → project-level → runtime → caller-provided.
  const systemPrompt = getSystemPromptForKind(argusSession.kind);
  const conductorSkill = getConductorSkill();
  const projectContext = `## Current Project\n\nYou are working in **${argusSession.repo_root}**. When using MCP tools that accept a \`project_path\` parameter, always pass \`${argusSession.repo_root}\` for work in this project. Use \`list_projects\` to discover paths for other projects.`;
  const orgContext = buildOrganizationContext(
    argusSession.repo_root,
    argusSession.id,
  );
  const combinedPrompt = [
    systemPrompt,
    projectContext,
    orgContext,
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
  safeWrite(initRequest + "\n");

  emitAgentStatus(agentId, agentSession.status);
  info(`[agent:${agentId}] started for session ${sessionId}`);

  // Wait for the CLI's initialize response before returning. Writing a user
  // message to stdin before the CLI has finished its handshake can cause the
  // message to be dropped (the child hasn't finished wiring its readline
  // loop yet). Callers like the OrgTask orchestrator depend on the first
  // message actually landing, so surface init failure as a thrown error.
  try {
    await controlHandler.waitForInit();
  } catch (e) {
    throw `Agent failed to initialize: ${String(e)}`;
  }

  const agentInfo: AgentInfo = {
    agent_id: agentId,
    session_id: sessionId,
    status: agentSession.status,
    parent_agent_id: parentAgentId ?? null,
    created_at: agentSession.createdAt,
    capabilities: controlHandler.getCapabilities(),
    model: agentSession.model,
  };

  return agentInfo;
}

// ---------------------------------------------------------------------------
// restore_agent_at_turn
// ---------------------------------------------------------------------------

/**
 * Restore an agent's conversation to a prior user turn, in place.
 *
 * Kills the current Claude child process, truncates its JSONL transcript to
 * `keepTurnNumber` real user turns (inclusive), deletes the old JSONL, and
 * respawns a fresh child under the **same** `agentId` — meaning no state
 * migration on the frontend, no listener rebind, no swap in the agent store.
 * The conversation keeps the same id end-to-end; only the underlying
 * subprocess and the Claude session UUID change.
 *
 * When `keepTurnNumber === 0` (first-message edit) the respawn starts fresh,
 * no `--resume`.
 *
 * While the dance is in flight the agent slot has `suppressStatus = true`,
 * so transient idle/stopped emissions are silenced — the UI's activity
 * indicator stays lit through the whole restore.
 *
 * Returns the new Claude session id, or `null` if no resume JSONL was
 * produced (fresh-start case).
 */
export async function restoreAgentAtTurn(args: {
  agentId: string;
  sourceClaudeSessionId: string;
  keepTurnNumber: number;
  cutoffTimestampMs: number;
}): Promise<{ claude_session_id: string | null }> {
  const session = appState.agents.get(args.agentId);
  if (!session) {
    throw `No agent found: ${args.agentId}`;
  }

  const sessionId = session.sessionId;
  const argusSession = appState.sessions.get(sessionId);
  if (
    !argusSession ||
    (argusSession.kind !== "worktree" && argusSession.kind !== "project_root")
  ) {
    throw `Cannot restore agent in session kind "${argusSession?.kind ?? "unknown"}"`;
  }

  // Pin status to "running" + silence the emit channel for the whole
  // kill/fork/respawn window. The frontend keeps whatever indicator state
  // it had; backend transitions stay internal.
  session.status = "running";
  session.suppressStatus = true;

  // Kill the child and wait for it to actually exit. The close handler on
  // this specific child instance will bail (because `agentEntry.child` will
  // be the NEW child by the time its close fires after respawn), so we
  // don't get a stopped/exit emission.
  const oldChild = session.child;
  const exited = new Promise<void>((resolve) => {
    if (oldChild.exitCode !== null || oldChild.killed) {
      resolve();

      return;
    }
    const onExit = () => resolve();
    oldChild.once("exit", onExit);
    oldChild.once("close", onExit);
  });
  try {
    oldChild.kill();
  } catch (e) {
    info(`[agent:${args.agentId}] restore kill returned: ${String(e)}`);
  }
  await Promise.race([
    exited,
    new Promise<void>((resolve) => setTimeout(resolve, 2000)),
  ]);

  // Cleanup the prior control handler — pending requests belong to the dead
  // process. The respawn below creates a fresh one.
  session.controlHandler?.cleanup();

  // Fork the JSONL into a new session file (same cwd, new UUID). Skipped
  // when keepTurnNumber=0 — the respawn then starts without --resume.
  let newClaudeSessionId: string | null = null;
  if (args.keepTurnNumber > 0) {
    const { forkClaudeSessionFile } = await import("../session/manager");
    newClaudeSessionId = await forkClaudeSessionFile({
      sourceCwd: argusSession.path,
      sourceSessionId: args.sourceClaudeSessionId,
      destCwd: argusSession.path,
      destBranch: argusSession.branch,
      forkTimestampMs: args.cutoffTimestampMs,
      forkTurnNumber: args.keepTurnNumber,
    });
    if (!newClaudeSessionId) {
      // Fork failed (empty result / missing source) — clear the suppress
      // flag so the agent isn't left in a permanently-silent state, then
      // throw so the caller can surface the error.
      session.suppressStatus = false;
      throw "Failed to truncate Claude session JSONL — nothing to resume";
    }

    // Delete the old JSONL now that the new one is written. Same-cwd
    // restore discards the trailing history by design.
    try {
      const oldFile = path.join(
        os.homedir(),
        ".claude",
        "projects",
        argusSession.path.replace(/[^a-zA-Z0-9]/g, "-"),
        `${args.sourceClaudeSessionId}.jsonl`,
      );
      const fs = await import("node:fs");
      fs.unlinkSync(oldFile);
    } catch (e) {
      info(`[agent:${args.agentId}] old JSONL unlink: ${String(e)}`);
    }
  }

  // Respawn the child in the SAME agent slot. `reuseAgentId` keeps the
  // agentId stable and `suppressStatus` carries over so the new session's
  // initial idle emission is silenced too. We clear the flag after spawn.
  // Pass `undefined` for model so `startAgent` falls back to the previous
  // slot's stored model — preserves variant suffixes (e.g. `[1m]`) that the
  // JSONL doesn't echo and that would otherwise default to a 200K window.
  await startAgent(
    sessionId,
    undefined, // model — startAgent carries over the previous slot's model
    undefined, // permissionMode
    newClaudeSessionId ?? undefined,
    undefined, // appendSystemPrompt
    undefined, // platformsOverride
    session.parentAgentId ?? undefined,
    args.agentId, // reuseAgentId
  );

  telemetryCapture("agent_restored", {
    is_fresh_start: args.keepTurnNumber === 0,
    keep_turn_number: args.keepTurnNumber,
  });

  // Clear the suppress flag on the NEW slot — from now on, status changes
  // flow normally. The caller is expected to write the next user message
  // immediately, which flips the UI to "running" via notifyMessageSent; any
  // transient idle between respawn and send has already been swallowed.
  const fresh = appState.agents.get(args.agentId);
  if (fresh) {
    fresh.suppressStatus = false;
    fresh.status = "running";
  }

  // Diagnostic: verify the truncated JSONL actually lands with the turn
  // count we asked for. Useful when debugging "Claude still remembers
  // discarded messages" reports — the log line surfaces the actual on-disk
  // state rather than trusting the frontend's view.
  if (newClaudeSessionId) {
    try {
      const fs = await import("node:fs");
      const newFile = path.join(
        os.homedir(),
        ".claude",
        "projects",
        argusSession.path.replace(/[^a-zA-Z0-9]/g, "-"),
        `${newClaudeSessionId}.jsonl`,
      );
      const content = fs.readFileSync(newFile, "utf8");
      const lines = content.split("\n").filter((l) => l.trim().length > 0);
      let realUserTurns = 0;
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          if (parsed.type === "user") {
            const message = parsed.message as { content?: unknown } | undefined;
            const msgContent = Array.isArray(message?.content)
              ? (message.content as unknown[])
              : [];
            const first = msgContent[0] as { type?: string } | undefined;
            if (first?.type === "text") {
              realUserTurns += 1;
            }
          }
        } catch {
          // ignore
        }
      }
      info(
        `[agent:${args.agentId}] restored at turn ${args.keepTurnNumber}: ` +
          `claude ${newClaudeSessionId}, ${lines.length} entries, ${realUserTurns} real user turns`,
      );
    } catch (e) {
      warn(`[agent:${args.agentId}] restore JSONL verify failed: ${String(e)}`);
    }
  } else {
    info(
      `[agent:${args.agentId}] restored fresh (no --resume) at turn ${args.keepTurnNumber}`,
    );
  }

  return { claude_session_id: newClaudeSessionId };
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

  // Await actual process exit (with a short timeout). Callers that restart
  // the agent immediately — e.g. edit-and-restore — rely on the old process
  // having released its stdout/JSONL writer before a replacement spawns.
  const exited = new Promise<void>((resolve) => {
    if (session.child.exitCode !== null || session.child.killed) {
      resolve();

      return;
    }
    const onExit = () => resolve();
    session.child.once("exit", onExit);
    session.child.once("close", onExit);
  });

  try {
    session.child.kill();
  } catch (e) {
    // The process may have already exited; treat as non-fatal.
    info(`[agent:${agentId}] child.kill() returned: ${String(e)}`);
  }

  await Promise.race([
    exited,
    new Promise<void>((resolve) => setTimeout(resolve, 2000)),
  ]);

  // Cleanup the control handler before removing the session.
  session.controlHandler?.cleanup();

  // Release device reservations and clean up.
  await simulatorPool.releaseSimulator(agentId);
  await webBrowserPool.releaseBrowser(agentId);

  appState.agents.delete(agentId);
  appState.agentSnapshots.delete(agentId);

  emitAgentStatus(agentId, "stopped");
  info(`[agent:${agentId}] stopped`);
  telemetryCapture("agent_stopped");
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
  if (session.status === "stopped" || session.status === "error") {
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
  telemetryCapture("agent_interrupted");
}

// ---------------------------------------------------------------------------
// wait_for_agent
// ---------------------------------------------------------------------------

/**
 * Wait for an agent's current turn to finish (status transitioning to
 * `idle`), or for the process to exit. The CLI subprocess stays alive
 * between turns, so waiting on `child.on("close")` alone would block
 * indefinitely for the common "agent finished responding" case.
 *
 * Resolves immediately if the agent is already `idle`, `stopped`, or `error`.
 *
 * @returns The agent's status (`idle` | `stopped` | `error`) and result
 *          summary if one has been captured.
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

  if (
    session.status === "stopped" ||
    session.status === "error" ||
    (session.status === "idle" && session.turnsCompleted > 0)
  ) {
    return Promise.resolve({
      status: session.status,
      result: session.resultSummary,
    });
  }

  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const settle = (status: AgentStatusValue) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      // Detach both waiters regardless of which fired.
      const exitIdx = session.exitWaiters.indexOf(onExit);
      if (exitIdx !== -1) {
        session.exitWaiters.splice(exitIdx, 1);
      }
      const turnIdx = session.turnWaiters.indexOf(onTurn);
      if (turnIdx !== -1) {
        session.turnWaiters.splice(turnIdx, 1);
      }
      const finalSession = appState.agents.get(agentId);
      resolve({
        status,
        result: finalSession?.resultSummary ?? null,
      });
    };

    const onExit = (exitCode: number) => {
      settle(exitCode === 0 ? "stopped" : "error");
    };
    const onTurn = (status: AgentStatusValue) => {
      settle(status);
    };

    session.exitWaiters.push(onExit);
    session.turnWaiters.push(onTurn);

    if (timeoutMs !== undefined && timeoutMs > 0) {
      timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        const exitIdx = session.exitWaiters.indexOf(onExit);
        if (exitIdx !== -1) {
          session.exitWaiters.splice(exitIdx, 1);
        }
        const turnIdx = session.turnWaiters.indexOf(onTurn);
        if (turnIdx !== -1) {
          session.turnWaiters.splice(turnIdx, 1);
        }
        reject(`Timeout waiting for agent ${agentId} after ${timeoutMs}ms`);
      }, timeoutMs);
    }
  });
}

// ---------------------------------------------------------------------------
// wait_for_any_agent
// ---------------------------------------------------------------------------

/**
 * Wait for the first of several agents to finish its current turn or exit.
 *
 * Resolves with the `agent_id` that settled plus its status and result. If
 * any agent is already idle/stopped/errored when called, returns immediately
 * for that one (lowest index in `agentIds` wins).
 *
 * @throws string if any `agent_id` is unknown or the timeout elapses.
 */
export function waitForAnyAgent(
  agentIds: string[],
  timeoutMs?: number,
): Promise<{
  agentId: string;
  result: AgentResult | null;
  status: AgentStatusValue;
}> {
  if (agentIds.length === 0) {
    throw `wait_for_any_agent: agent_ids must be non-empty`;
  }

  // Validate up front so we never attach waiters to a partial set.
  const sessions = agentIds.map((id) => {
    const s = appState.agents.get(id);
    if (!s) {
      throw `No agent found: ${id}`;
    }

    return { id, session: s };
  });

  // Fast path — any already-terminal agent settles immediately.
  for (const { id, session } of sessions) {
    if (
      session.status === "stopped" ||
      session.status === "error" ||
      (session.status === "idle" && session.turnsCompleted > 0)
    ) {
      return Promise.resolve({
        agentId: id,
        result: session.resultSummary,
        status: session.status,
      });
    }
  }

  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    // Track each agent's waiters so we can detach them all when one fires.
    const detachers: (() => void)[] = [];

    const settle = (
      agentId: string,
      status: AgentStatusValue,
      result: AgentResult | null,
    ) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      for (const detach of detachers) {
        detach();
      }
      resolve({ agentId, result, status });
    };

    for (const { id, session } of sessions) {
      const onExit = (exitCode: number) => {
        const final = appState.agents.get(id);
        settle(
          id,
          exitCode === 0 ? "stopped" : "error",
          final?.resultSummary ?? null,
        );
      };
      const onTurn = (status: AgentStatusValue) => {
        const final = appState.agents.get(id);
        settle(id, status, final?.resultSummary ?? null);
      };

      session.exitWaiters.push(onExit);
      session.turnWaiters.push(onTurn);
      detachers.push(() => {
        const exitIdx = session.exitWaiters.indexOf(onExit);
        if (exitIdx !== -1) {
          session.exitWaiters.splice(exitIdx, 1);
        }
        const turnIdx = session.turnWaiters.indexOf(onTurn);
        if (turnIdx !== -1) {
          session.turnWaiters.splice(turnIdx, 1);
        }
      });
    }

    if (timeoutMs !== undefined && timeoutMs > 0) {
      timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        for (const detach of detachers) {
          detach();
        }
        reject(
          `Timeout waiting for any of ${agentIds.length} agents after ${timeoutMs}ms`,
        );
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
  const agentEntry = appState.agents.get(agentId);
  if (!agentEntry) {
    throw `No agent found: ${agentId}`;
  }
  if (agentEntry.status === "stopped" || agentEntry.status === "error") {
    throw `Agent is not running: ${agentId}`;
  }

  // Track slash command usage for autocomplete sorting.
  const trimmed = message.trim();
  if (trimmed.startsWith("/")) {
    const cmdName = trimmed.slice(1).split(/\s+/)[0];
    if (cmdName) {
      const session = appState.sessions.get(agentEntry.sessionId);
      if (session?.repo_root) {
        incrementCommandMetric(session.repo_root, cmdName);
      }
    }
  }

  const payload = buildUserMessagePayload(message, images ?? []);

  try {
    agentEntry.stdin.write(payload + "\n");
  } catch (e) {
    throw `Failed to write to agent stdin: ${String(e)}`;
  }

  // Track that a prompt is in flight so observers outside the renderer (tray,
  // vitals) don't get fooled by a transient `session_state_changed:idle`
  // emitted between tool calls within the same turn.
  agentEntry.inflightPrompts += 1;
}

// ---------------------------------------------------------------------------
// MCP system messages
// ---------------------------------------------------------------------------

/**
 * Payload pushed to the renderer so an MCP-injected message (initial prompt
 * on spawn, or follow-up) appears in the recipient agent's conversation UI
 * as a system message. Display-only — the actual prompt is still delivered
 * to the agent via stdin by the regular {@link sendAgentMessage} path.
 */
export interface McpSystemMessagePayload {
  tool: "send_agent_message" | "spawn_agent" | "spawn_agents_batch";
  message: string;
  images?: ImageAttachment[];
  parentAgentId?: string;
  parentLabel?: string;
  timestamp: number;
}

/**
 * Resolve a human-readable label for an originating parent agent. Falls back
 * to an empty string when the parent has already exited or was never known.
 */
function resolveParentLabel(parentAgentId: string | undefined): string {
  if (!parentAgentId) {
    return "";
  }
  const parent = appState.agents.get(parentAgentId);
  if (!parent) {
    return "";
  }
  const session = appState.sessions.get(parent.sessionId);
  if (!session) {
    return "";
  }

  return session.display_name ?? session.branch ?? "";
}

/**
 * Emit a system-message event that the renderer renders in the recipient
 * agent's conversation view. Safe no-op if the main window is gone.
 */
export function emitMcpSystemMessage(
  recipientAgentId: string,
  payload: Omit<McpSystemMessagePayload, "parentLabel" | "timestamp"> & {
    parentLabel?: string;
  },
): void {
  const parentLabel =
    payload.parentLabel ?? resolveParentLabel(payload.parentAgentId);
  const full: McpSystemMessagePayload = {
    tool: payload.tool,
    message: payload.message,
    images: payload.images,
    parentAgentId: payload.parentAgentId,
    parentLabel,
    timestamp: Date.now(),
  };
  broadcastToRenderers(`agent:mcp-message:${recipientAgentId}`, full);
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
  if (session.status === "stopped" || session.status === "error") {
    throw `Agent is not running: ${agentId}`;
  }

  const handler = session.controlHandler;
  if (!handler) {
    throw `Agent has no control handler: ${agentId}`;
  }

  const [json, promise] = handler.buildSetModelRequest(model);
  session.stdin.write(json + "\n");
  await promise;

  // Persist the new model on the session so a later restore-at-turn or
  // restartAgent re-passes it on respawn.
  session.model = model;

  broadcastToRenderers(`agent:model-changed:${agentId}`, model);
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
  if (session.status === "stopped" || session.status === "error") {
    throw `Agent is not running: ${agentId}`;
  }

  const handler = session.controlHandler;
  if (!handler) {
    throw `Agent has no control handler: ${agentId}`;
  }

  const [json, promise] = handler.buildSetPermissionModeRequest(mode);
  session.stdin.write(json + "\n");
  await promise;

  broadcastToRenderers(`agent:permission-mode-changed:${agentId}`, mode);
  info(`[agent:${agentId}] permission mode changed to ${mode}`);
}

// ---------------------------------------------------------------------------
// list_agents
// ---------------------------------------------------------------------------

/**
 * Return all agents for a given session.
 */
export function listAgents(sessionId: string): AgentInfo[] {
  const result: AgentInfo[] = [];
  for (const session of appState.agents.values()) {
    // Skip prewarmed (eager-spawned) agents — they're invisible until the
    // renderer claims one by sending its first message. Surfacing them here
    // would let MCP tools (`list_agents`, child-counters) treat the warm
    // slot as real work, and confuse `wait_for_any_agent`.
    if (session.prewarmed) {
      continue;
    }
    if (session.sessionId === sessionId) {
      result.push({
        agent_id: session.agentId,
        session_id: session.sessionId,
        status: session.status,
        parent_agent_id: session.parentAgentId,
        created_at: session.createdAt,
        model: session.model,
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// prewarm_agent / claim_prewarm_agent / discard_prewarm_agent
// ---------------------------------------------------------------------------

/**
 * Eagerly spawn a Claude subprocess and run the initialize handshake so the
 * Start-agent dialog can show real models/slash-commands and the eventual
 * "send" path skips the 1–3s spawn + init wait. The returned agent stays
 * invisible (filtered out of `listAgents`) until claimed.
 *
 * Reuses `startAgent` for the actual spawn so the prewarmed slot has all the
 * usual lifecycle hooks (status updates, exit handlers, control protocol).
 * The only difference is the `prewarmed` flag, which gates visibility.
 */
export async function prewarmAgent(sessionId: string): Promise<AgentInfo> {
  const spawned = await startAgent(sessionId);
  const session = appState.agents.get(spawned.agent_id);
  if (session) {
    session.prewarmed = true;
  }

  return spawned;
}

/**
 * Promote a prewarmed agent into a normal agent slot. Optionally applies a
 * model + permission-mode change first (via the existing control protocol)
 * so the user's dialog selections take effect before the first message.
 *
 * Throws if the agent is unknown or was not prewarmed in the first place.
 */
export async function claimPrewarmAgent(
  agentId: string,
  opts: { model?: string; permissionMode?: string } = {},
): Promise<AgentInfo> {
  const session = appState.agents.get(agentId);
  if (!session) {
    throw `No agent found: ${agentId}`;
  }
  if (!session.prewarmed) {
    throw `Agent ${agentId} is not prewarmed`;
  }

  if (opts.model && opts.model !== session.model) {
    await setAgentModel(agentId, opts.model);
  }
  if (opts.permissionMode) {
    await setAgentPermissionMode(agentId, opts.permissionMode);
  }

  session.prewarmed = false;

  return {
    agent_id: session.agentId,
    session_id: session.sessionId,
    status: session.status,
    parent_agent_id: session.parentAgentId,
    created_at: session.createdAt,
    capabilities: session.controlHandler?.getCapabilities() ?? null,
    model: session.model,
  };
}

/**
 * Kill a prewarmed agent that is no longer wanted (session closed, app
 * quitting, or a fresh prewarm replacing it). Quietly no-ops if the agent
 * is already gone or has already been claimed.
 */
export async function discardPrewarmAgent(agentId: string): Promise<void> {
  const session = appState.agents.get(agentId);
  if (!session || !session.prewarmed) {
    return;
  }
  await stopAgent(agentId);
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
 * platforms this session actually targets and whatever devices are already
 * attached/reserved at agent start. Falls back to the full triple when
 * `.argus.json` does not declare `platforms`.
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
    "You are running inside **Argus**, an agentic IDE. The user can see your code editor, a terminal, and one or more **runtime views** side by side. These runtime views show the live state of the app or website you are working on — the user is looking at them right now.",
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
        "An iOS simulator is attached to your session. It will be provisioned automatically the first time you run a `conductor` command — do **not** call `conductor start-device` yourself.",
      );
    }
  }

  if (platforms.has("tvos")) {
    lines.push(
      "",
      "### tvOS Simulator",
      "",
      "A tvOS simulator may be available. Use `conductor list-devices` to find a booted tvOS device, then target it explicitly with `--device <udid>` (or `--device-name`). Native installs (e.g. `xcrun simctl install <udid> <path/to/app>`) must also target the UDID directly.",
    );
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
      ? " A live CDP session is already wired to this session's webview."
      : "";
    lines.push(
      "",
      "### Web Browser",
      "",
      `A web browser view is attached to your session${browserDefault}.${cdpNote} The user can see this browser view in the runtime panel. When the user asks about "the website", "the page", or "what site we're on", they are referring to this web browser view.`,
      "",
      "To interact with the web browser view, use `conductor` with `--device web`:",
      "- `conductor inspect --device web` — see what's on the web page (ARIA tree, element names)",
      "- `conductor take-screenshot --device web` — capture the web browser view",
      '- `conductor tap-on "element" --device web` — click an element in the web page',
      '- `conductor input-text "text" --device web` — type text into the focused field',
      "- `conductor open-link <url> --device web` — navigate the web browser to a URL",
      "",
      "Argus wires `--device web` directly to this session's webview via CDP — conductor does **not** spawn a separate browser window. If the webview is reloaded or the runtime panel is torn down, run `conductor daemon-stop --device web` once to clear the stale connection; the next command will reconnect automatically.",
    );
  }

  lines.push("", "### Using conductor", "");
  lines.push(
    "Use the `conductor` CLI to interact with and observe all runtime views. Run `conductor --help` for usage.",
    "",
    "Device targeting:",
  );
  if (platforms.has("ios")) {
    lines.push(
      '- **iOS simulator**: `conductor <command>` (no `--device` flag needed — auto-provisioned on first use). To target a specific booted device when multiple exist, use `--device-name "<name>"` (e.g. a reference simulator running a different build).',
    );
  }
  if (platforms.has("tvos")) {
    lines.push(
      "- **tvOS simulator**: `conductor <command> --device <tvos-udid>` (run `conductor list-devices` to find the UDID).",
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

  if (
    platforms.has("ios") ||
    platforms.has("android") ||
    platforms.has("tvos")
  ) {
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
  const session = appState.agents.get(agentId);
  if (session?.suppressStatus) {
    // Restore-at-turn window — swallow transient transitions so the UI
    // indicator doesn't flicker between the kill and the next user-driven
    // running state.
    return;
  }
  broadcastToRenderers(`agent:status:${agentId}`, status);
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
