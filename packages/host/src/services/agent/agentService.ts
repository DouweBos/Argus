/**
 * Agent service — runner-agnostic LLM agent orchestration.
 *
 * Was `electron/services/agent/claude.ts`, split in Phase 1 of the LLM
 * routing abstraction so the underlying CLI subprocess + wire protocol live
 * behind {@link LlmRunner}. This module is responsible for:
 *
 * - Resolving a runner via the registry (today: always Claude Code).
 * - Building the per-agent system prompt + runtime section.
 * - MCP injection (gated on {@link RunnerCapabilities.supportsMcp}).
 * - Simulator + browser device acquisition for `can_use_tool` interception.
 * - Tracking `agent_vitals` counters by listening on the runner's
 *   normalized `stream-event` emitter.
 * - Forwarding the runner's events onto the existing IPC channels the
 *   renderer already consumes:
 *     - `agent:event:{agentId}`              raw stream lines
 *     - `agent:exit:{agentId}`               exit code
 *     - `agent:status:{agentId}`             status transitions
 *     - `agent:permission:{agentId}`         permission requests
 *     - `agent:permission-cancel:{agentId}`  permission cancellations
 *     - `agent:capabilities:{agentId}`       initialize response
 *     - `agent:stderr:{agentId}`             stderr lines
 *     - `agent:model-changed:{agentId}`      model swap
 *     - `agent:permission-mode-changed:{agentId}` permission-mode swap
 */

import type {
  AgentInfo,
  AgentResult,
  AgentSession,
  AgentStatusValue,
} from "./models";
import type {
  AndroidDeviceSession,
  BrowserSession,
  SimulatorReservation,
} from "../../state";
import type { ConversationMessage } from "./conversation/types";
import type { NewSpare } from "./spares";
import type { PermissionRequestPayload } from "../llm/runners/claudeCode/controlHandler";
import type { LlmRunner, PermissionPreHook } from "../llm/runners/types";
import type { RuntimePlatform, Session, SessionKind } from "../session/models";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { emitHostEvent } from "@argus/host/bus";
import { info, warn } from "@argus/host/logger";
import { hostPlatform } from "@argus/host/platform";
import { argusHomeDir } from "../../lib/argusHome";
import { checkoutRoot } from "../../lib/checkoutRoot";
import { appState } from "../../state";
import {
  automationDisallowedTools,
  automationPermissionPreHook,
} from "../automation/shellGuard";
import { webBrowserPool } from "../browser/pool";
import {
  type AuthOutcome,
  classifyRunFailure,
  classifyStreamLine,
  clearAuthFailure,
  envForAccount,
  recordAuthOutcome,
  resolveAccountForSession,
} from "../claudeAuth/accounts";
import { emitAccountsChanged } from "../claudeAuth/claudeAuth";
import { noteUsageRateLimitLine } from "../claudeUsage/limits";
import { getConductorBinDir } from "../cli/conductor";
import { getRunnerById, resolveDefaultRunner } from "../llm/registry";
import { resolveModelForAgent } from "../llm/resolve";
import { toCanonicalPermissionMode } from "../llm/runners/claudeCode/permissionModes";
import { getMcpAuthToken, getMcpPort } from "../mcp/server";
import { buildMergedMcpServers } from "../mcp/userConfig";
import { loadArgusConfig } from "../session/argusConfig";
import { incrementCommandMetric } from "../session/commandMetrics";
import { sessionRunnerId } from "../session/models";
import { simulatorPool } from "../simulator/pool";
import { capture as telemetryCapture } from "../telemetry/telemetry";
import { loadConversationByRunnerSession } from "./chatHistory";
import { injectDeviceFlag, isConductorInvocation } from "./conductorInjection";
import {
  contextWindowFromModelUsage,
  rememberContextWindow,
} from "./contextWindow";
import { stageConversation, takeStagedConversation } from "./conversation/live";
import { fromSavedMessages } from "./conversation/reducer";
import { noteLimitStallStarted } from "./limitHandoff";
import {
  cancelLimitResume,
  forgetLimitResume,
  noteLimitHit,
  noteRateLimitLine,
  onTurnResult,
} from "./limitResume";
import { clearQueue } from "./messageQueue";
import { resultSubtype } from "./models";
import { clearSpares, hasSpare, killSpare, takeSpare } from "./spares";
import { spawnConfigStamp } from "./spawnStamp";
import { rememberStartOptions } from "./startOptions";

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
  const existing = await webBrowserPool.liveReservation(agentId);
  if (existing) {
    return existing.deviceId;
  }

  const reservation = await webBrowserPool.acquireBrowser(agentId);

  return reservation.deviceId;
}

// ---------------------------------------------------------------------------
// System-prompt loading
// ---------------------------------------------------------------------------

const cachedPrompts: Record<string, string | null> = {
  worktree: null,
  repo_root: null,
};

function loadPromptFile(filename: string): string {
  try {
    const promptPath = hostPlatform().isPackaged()
      ? path.join(hostPlatform().resourcesPath(), filename)
      : path.join(checkoutRoot(), "packages", "host", "prompts", filename);

    return readFileSync(promptPath, "utf-8");
  } catch (e) {
    warn(`Failed to load prompt ${filename}: ${String(e)}`);

    return "";
  }
}

// Read-only runs sit in plan mode so the CLI refuses writes, but its reminder
// also talks the model out of the reporting tools the run exists to call.
const AUTOMATION_HOST_PROMPT = `## Automation runs and plan mode

This is an unattended automation run. If Claude Code says plan mode is active, it is on only to stop writes to files and repos. For this run, that reminder is narrowed as follows:

- \`emit_report\`, \`emit_proposal\`, \`withdraw_proposal\`, \`save_memory\` and \`delete_memory\` are reporting tools, not edits. Call them as the run's instructions say; Argus allows them.
- Do not write a plan file and do not call \`ExitPlanMode\`. Nobody is there to approve a plan; the report is the deliverable.
- Everything else in plan mode still holds: no edits, no commits, no commands that change anything.`;

const SCRATCH_PAD_PROMPT = `## Scratch pad

You are working in an Argus scratch pad: a standalone directory for one-off work that belongs to no project and is not a git repository. Files you create here stay until the user deletes the scratch pad.

The user's projects are readable at their absolute paths. When a task needs changes in one of them, prefer creating a session there with the Argus MCP tools over editing its checkout directly.`;

function getSystemPromptForKind(kind: SessionKind): string {
  // An automation host is not a checkout, so neither repo prompt applies —
  // its instructions come from the automation's playbook instead.
  if (kind === "automation_host") {
    return AUTOMATION_HOST_PROMPT;
  }
  if (kind === "scratch_pad") {
    return SCRATCH_PAD_PROMPT;
  }
  if (cachedPrompts[kind] === null) {
    cachedPrompts[kind] =
      kind === "project_root"
        ? loadPromptFile("root-agent-system-prompt.md")
        : loadPromptFile("worktree-agent-system-prompt.md");
  }

  return cachedPrompts[kind] ?? "";
}

// ---------------------------------------------------------------------------
// check_claude_cli (back-compat name; delegates to runner.preflight())
// ---------------------------------------------------------------------------

/**
 * Resolve the active runner's CLI binary path. Throws a descriptive string
 * when the binary cannot be found. The IPC handler still references
 * `check_claude_cli` and `checkClaudeCli` for back-compat.
 */
export async function checkClaudeCli(): Promise<string> {
  const runner = resolveDefaultRunner();
  const result = await runner.preflight();
  if (!result.ok) {
    throw result.reason;
  }

  return result.binPath;
}

// ---------------------------------------------------------------------------
// start_agent
// ---------------------------------------------------------------------------

/**
 * Permission mode a spawn falls back to when neither the caller nor a reused
 * slot specifies one. `auto` keeps the smart classifier in charge so that
 * back-end-initiated spawns (MCP `spawn_agent`, restore-at-turn) never drop
 * to the CLI's prompt-for-everything default. Renderer-initiated spawns pass
 * the app-level default permission mode explicitly.
 */
const DEFAULT_AGENT_PERMISSION_MODE = "auto";

/**
 * Start a resumed agent's conversation from its saved history, so it shows
 * the turns it is actually resuming from. No-op when nothing was saved for
 * that runner session.
 */
function seedResumedConversation(
  agentId: string,
  repoRoot: string,
  runnerSessionId: string,
): void {
  try {
    const saved = loadConversationByRunnerSession(repoRoot, runnerSessionId);
    if (!saved || saved.messages.length === 0) {
      return;
    }
    stageConversation(agentId, {
      ...fromSavedMessages(saved.messages as ConversationMessage[], {
        model: saved.model,
        sessionId: runnerSessionId,
        // Drops the turn the CLI replays on --resume.
        resuming: true,
        title: saved.title,
      }),
      totalCost: saved.totalCost,
      totalDuration: saved.totalDuration,
    });
  } catch (e) {
    warn(`[agent:${agentId}] failed to seed resumed transcript: ${String(e)}`);
  }
}

function liveSession(sessionId: string): Session & { path: string } {
  const argusSession = appState.sessions.get(sessionId);
  if (!argusSession) {
    throw `Session not found: ${sessionId}`;
  }
  if (!argusSession.path) {
    throw `Session ${sessionId} is still initializing`;
  }
  if (!existsSync(argusSession.path)) {
    appState.sessions.delete(sessionId);
    emitHostEvent("session:deleted", sessionId);
    throw `Session working directory no longer exists: ${argusSession.path}`;
  }

  return argusSession as Session & { path: string };
}

/**
 * Spawn a new agent process for the given session — or hand over the
 * session's warm spare when the request is one a spare can serve. A taken
 * spare keeps its own id: it is baked into the CLI's env, MCP header and
 * system prompt, so `presetAgentId` only names a fresh spawn.
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
  presetAgentId?: string,
  runnerIdOverride?: string,
  allowSpare = true,
): Promise<AgentInfo> {
  const argusSession = liveSession(sessionId);
  const previous = reuseAgentId ? appState.agents.get(reuseAgentId) : null;
  const plan = resolveSpawnPlan(argusSession, {
    model,
    permissionMode,
    previous,
    runnerIdOverride,
  });

  // Everything else a spare can't take is spawn-only: a resume, extra system
  // prompt, platforms baked into the runtime section, `bypassPermissions`.
  const spareable =
    allowSpare &&
    !reuseAgentId &&
    !resumeSessionId &&
    !appendSystemPrompt &&
    !platformsOverride?.length &&
    plan.permissionMode !== "trusted" &&
    plan.permissionMode !== "bypassPermissions";
  if (spareable && hasSpare(sessionId)) {
    const spare = takeSpare(sessionId, {
      runnerId: plan.runner.id,
      accountId: plan.accountId,
      configStamp: await spawnConfigStamp(argusSession),
    });
    const adopted = spare && (await adoptSpare(spare, plan));
    if (adopted) {
      return announceStart(adopted, argusSession, {
        model,
        permissionMode,
        parentAgentId,
      });
    }
  }

  const agentId = reuseAgentId ?? presetAgentId ?? crypto.randomUUID();
  const agentSession = await spawnAgentSession({
    argusSession,
    agentId,
    plan,
    resumeSessionId,
    appendSystemPrompt,
    platformsOverride,
    parentAgentId,
    previous,
    reused: Boolean(reuseAgentId),
    register: true,
  });

  if (!reuseAgentId) {
    telemetryCapture("agent_started", {
      has_model: Boolean(model),
      has_resume_id: Boolean(resumeSessionId),
      has_parent: Boolean(parentAgentId),
      permission_mode: permissionMode ?? "default",
      session_kind: argusSession.kind,
      warm: false,
    });
  }

  emitAgentStatus(agentId, agentSession.status);
  info(`[agent:${agentId}] started for session ${sessionId}`);

  // Wait for the runner's initialize handshake before returning.
  try {
    await agentSession.handle.waitForInit();
  } catch (e) {
    throw `Agent failed to initialize: ${String(e)}`;
  }

  return agentInfoOf(agentSession);
}

function agentInfoOf(agent: AgentSession): AgentInfo {
  return {
    agent_id: agent.agentId,
    session_id: agent.sessionId,
    status: agent.status,
    parent_agent_id: agent.parentAgentId,
    created_at: agent.createdAt,
    capabilities: agent.handle.initializeResponse(),
    model: agent.model,
    runner_id: agent.runner.id,
  };
}

/**
 * Bring a taken spare to what the request resolved to. Out of the pool and
 * not yet listed, so a failed runtime switch just costs a fresh spawn.
 */
async function adoptSpare(
  spare: AgentSession,
  plan: SpawnPlan,
): Promise<AgentSession | null> {
  try {
    if (plan.model && plan.model !== spare.model) {
      await spare.handle.setModel(plan.model);
      spare.model = plan.model;
    }
    if (plan.permissionMode !== spare.permissionMode) {
      await spare.handle.setPermissionMode(plan.permissionMode);
      spare.permissionMode = plan.permissionMode;
    }
  } catch (e) {
    warn(`[agent:${spare.agentId}] spare refused its settings: ${String(e)}`);
    killSpare(spare);

    return null;
  }

  return spare;
}

function announceStart(
  agent: AgentSession,
  argusSession: Session,
  request: { model?: string; permissionMode?: string; parentAgentId?: string },
): AgentInfo {
  agent.parentAgentId = request.parentAgentId ?? null;
  agent.createdAt = Date.now();
  agent.lastEventAt = agent.createdAt;
  appState.agents.set(agent.agentId, agent);
  telemetryCapture("agent_started", {
    has_model: Boolean(request.model),
    has_resume_id: false,
    has_parent: Boolean(request.parentAgentId),
    permission_mode: request.permissionMode ?? "default",
    session_kind: argusSession.kind,
    warm: true,
  });
  emitAgentStatus(agent.agentId, agent.status);
  info(
    `[agent:${agent.agentId}] took the warm spare for session ${agent.sessionId}`,
  );

  return agentInfoOf(agent);
}

/**
 * Spawn the session's warm spare: a fresh agent past initialize, under the
 * session's runner and account, kept out of `appState.agents`.
 */
export async function spawnSpare(
  sessionId: string,
  runnerId?: string,
): Promise<NewSpare> {
  const argusSession = liveSession(sessionId);
  const plan = resolveSpawnPlan(argusSession, { runnerIdOverride: runnerId });
  const configStamp = await spawnConfigStamp(argusSession);
  const agent = await spawnAgentSession({
    argusSession,
    agentId: crypto.randomUUID(),
    plan,
    reused: false,
    register: false,
  });
  try {
    await agent.handle.waitForInit();
  } catch (e) {
    killSpare(agent);
    throw `Spare failed to initialize: ${String(e)}`;
  }

  return { agent, configStamp };
}

/** What a spawn settles before it has an agent id. */
interface SpawnPlan {
  runner: LlmRunner;
  model: string | null;
  permissionMode: string;
  accountId: string;
}

function resolveSpawnPlan(
  argusSession: Session,
  opts: {
    model?: string;
    permissionMode?: string;
    previous?: AgentSession | null;
    runnerIdOverride?: string;
  },
): SpawnPlan {
  const previousAgentForModel = opts.previous;

  // Resolve the permission mode: explicit caller override → the mode the
  // reused slot ran with (restore-at-turn / restart) → app-wide default.
  // Applied at spawn time via `--permission-mode`, which is the only way the
  // Claude CLI honours spawn-only modes like `auto`. Every agent gets a
  // deliberate mode here — spares included.
  const effectivePermissionMode =
    opts.permissionMode ??
    previousAgentForModel?.permissionMode ??
    DEFAULT_AGENT_PERMISSION_MODE;

  // Resolve the runner. The session's `runner_id` is only the default for
  // new agents — each agent carries its own, switchable until its first
  // prompt, and preserved across respawns via the reused slot. Legacy
  // sessions persisted before `runner_id` existed default to `"claude-code"`.
  const sessionDefaultRunnerId = sessionRunnerId(argusSession);
  const runnerId =
    opts.runnerIdOverride ??
    previousAgentForModel?.runner.id ??
    sessionDefaultRunnerId;
  let runner: LlmRunner | null = getRunnerById(runnerId);
  if (!runner) {
    // Runner was unregistered between session create and now — fall back
    // to today's single-runner behaviour rather than failing the spawn.
    warn(
      `[session:${argusSession.id}] runner_id "${runnerId}" not registered; falling back to default runner`,
    );
    runner = resolveDefaultRunner();
  }

  // Resolve the model via the per-spawn cascade (override → session →
  // project → app → runner default). Project default is the only level
  // available in the main process today; app default lives in the
  // renderer's settings store.
  let projectLlmConfig:
    | { llm?: { runner?: string | null; model?: string | null } | null }
    | undefined;
  try {
    projectLlmConfig = loadArgusConfig(argusSession.repo_root);
  } catch {
    projectLlmConfig = undefined;
  }
  // Model ids don't carry across runners — a gateway rejects the other
  // runner's. Once the agent has left the session's default runner, only its
  // own model and the runner default are in play.
  const onSessionRunner = runner.id === sessionDefaultRunnerId;
  const { model: effectiveModel } = resolveModelForAgent({
    session: {
      runner_id: runner.id,
      // Restore-at-turn reuses the previous agent's model so we don't drop
      // variant suffixes (e.g. `[1m]`) that aren't preserved in the JSONL.
      model: onSessionRunner
        ? (argusSession.model ?? previousAgentForModel?.model ?? null)
        : (previousAgentForModel?.model ?? null),
    },
    agentOverride: { model: opts.model ?? null },
    ...(onSessionRunner ? { argusConfig: projectLlmConfig } : {}),
    runnerDefaultModel: runner.defaultModel?.() ?? null,
  });

  return {
    runner,
    model: effectiveModel,
    permissionMode: effectivePermissionMode,
    accountId: resolveAccountForSession(argusSession),
  };
}

interface SpawnArgs {
  argusSession: Session & { path: string };
  agentId: string;
  plan: SpawnPlan;
  resumeSessionId?: string;
  appendSystemPrompt?: string;
  platformsOverride?: RuntimePlatform[];
  parentAgentId?: string;
  /** The slot a respawn reuses; its counters carry over. */
  previous?: AgentSession | null;
  reused: boolean;
  /** Listed in `appState.agents` before its first event lands; a spare stays out. */
  register: boolean;
}

/** Spawn the CLI and wire its events; the caller decides when it's listed. */
async function spawnAgentSession(args: SpawnArgs): Promise<AgentSession> {
  const {
    argusSession,
    agentId,
    plan,
    resumeSessionId,
    appendSystemPrompt,
    platformsOverride,
    parentAgentId,
    previous,
  } = args;
  const { runner, accountId } = args.plan;
  const sessionId = argusSession.id;
  const worktreePath = argusSession.path;

  // Per-agent debug log.
  const agentLogsDir = path.join(argusHomeDir(), "agents");
  mkdirSync(agentLogsDir, { recursive: true });
  const debugLogPath = path.join(agentLogsDir, `${agentId}.debug.log`);

  // Build MCP servers map (gated on runner capability).
  const mcpPort = getMcpPort();
  const mcpToken = getMcpAuthToken();
  const supportsMcp = runner.capabilities().supportsMcp;
  const mcpServers =
    supportsMcp && mcpPort && mcpToken
      ? await buildMergedMcpServers(worktreePath, {
          argus: {
            type: "http",
            url: `http://127.0.0.1:${mcpPort}/mcp`,
            headers: {
              Authorization: `Bearer ${mcpToken}`,
              // Identifies this agent to the MCP server so parent-relationship
              // tools (spawn_agent, etc.) can attribute spawns to it without
              // the agent having to know its own ID.
              "X-Argus-Agent-Id": agentId,
            },
          },
        })
      : {};

  // Build env. Conductor shim on PATH; resolver URL/token for lazy device
  // acquisition; long MCP timeouts so wait_for_agent etc. don't time out.
  // `envForAccount` also clears an inherited credential dir, so a session
  // pinned to the default account isn't dragged onto the globally active one.
  const env = envForAccount(accountId);
  env.PATH = `${getConductorBinDir()}:${env.PATH ?? ""}`;
  env.ARGUS_AGENT_ID = agentId;
  if (supportsMcp && mcpPort && mcpToken) {
    env.ARGUS_RESOLVER_URL = `http://127.0.0.1:${mcpPort}/argus/acquire-device`;
    env.ARGUS_RESOLVER_TOKEN = mcpToken;
  }
  env.MCP_TOOL_TIMEOUT = "86400000";
  env.MCP_TIMEOUT = env.MCP_TIMEOUT ?? "30000";

  // Combine prompts: kind-specific → project context → project-level →
  // runtime → caller-provided.
  let projectPrompt: string | null = null;
  let browserUrl: string | null = null;
  let configPlatforms: RuntimePlatform[] | null = null;
  try {
    const config = loadArgusConfig(argusSession.repo_root);
    projectPrompt = config.agent_prompt ?? null;
    browserUrl = config.browser_url ?? null;
    configPlatforms = config.platforms ?? null;
  } catch {
    // Config missing or invalid — non-fatal.
  }
  const resolvedPlatforms =
    platformsOverride && platformsOverride.length > 0
      ? platformsOverride
      : (configPlatforms ?? []);

  const runtimeSection = buildRuntimeSection({
    platforms: new Set(resolvedPlatforms),
    iosReservation: appState.simulatorReservations.get(agentId) ?? null,
    androidDevices: [...appState.androidDevices.values()],
    browserSession: appState.browserSessions.get(sessionId) ?? null,
    browserUrl,
  });

  const systemPrompt = getSystemPromptForKind(argusSession.kind);
  const projectContext = `## Current Project\n\nYou are working in **${argusSession.repo_root}**. When using MCP tools that accept a \`project_path\` parameter, always pass \`${argusSession.repo_root}\` for work in this project. Use \`list_projects\` to discover paths for other projects.\n\nYour own agent ID is \`${agentId}\`. The Argus MCP already knows who you are, so you normally don't need to pass it — \`parent_agent_id\` on \`spawn_agent\`/\`create_session\`/\`send_agent_message\` defaults to you automatically.`;
  const combinedPrompt = [
    systemPrompt,
    projectContext,
    projectPrompt,
    runtimeSection,
    appendSystemPrompt,
  ]
    .filter(Boolean)
    .join("\n\n");

  // Permission pre-hook: intercept can_use_tool for Bash to splice in a
  // simulator UDID when the agent runs `conductor` without --device.
  // An agent Argus started on behalf of an automation is held to that
  // automation's rung at the shell too — `git push` from Bash is the same act
  // as `open_session_pr` over MCP, and only this sees it.
  const automationGuard = automationPermissionPreHook(sessionId);

  const permissionPreHook: PermissionPreHook = (req) => {
    const refused = automationGuard(req);
    if (refused) {
      return refused;
    }
    if (req.toolName !== "Bash") {
      return null;
    }
    const cmd = (req.input.command as string) ?? "";
    if (!isConductorInvocation(cmd) || cmd.includes("--device")) {
      return null;
    }

    // Async simulator acquisition. We take over the request and respond
    // ourselves once the UDID arrives (or the timeout fires).
    const SIM_ACQUIRE_TIMEOUT_MS = 60_000;
    let settled = false;
    const handle = appState.agents.get(agentId)?.handle;
    if (!handle) {
      // No handle yet — fall through to normal path. Should never happen:
      // pre-hook only fires while the readline loop is running.
      return null;
    }
    const respondWith = (rewrittenCmd: string | null) => {
      const finalInput =
        rewrittenCmd !== null
          ? { ...req.input, command: rewrittenCmd }
          : req.input;
      // Build a `behavior: allow` control_response synchronously and write
      // it via the runner-provided approveRaw escape hatch. Mirrors the
      // legacy fast-path that used `controlHandler.handleControlRequest`.
      // We synthesise the protocol here because the runner's
      // ControlHandler is not in scope; the request_id of the original
      // control_request is on `req.rawRequest`.
      const rawReq = req.rawRequest as { request_id?: string } | undefined;
      const requestId = rawReq?.request_id ?? "";
      const responseLine = JSON.stringify({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: requestId,
          response: { behavior: "allow", updatedInput: finalInput },
        },
      });
      req.approveRaw(responseLine);
    };

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
        warn(`[agent:${agentId}] simulator acquisition failed: ${String(e)}`);
        respondWith(null);
      });

    return { kind: "handled" };
  };

  // Spawn via the runner. The handle owns the child + readline + control
  // protocol; we subscribe to its events below.
  const handle = await runner.spawn({
    agentId,
    sessionId,
    cwd: worktreePath,
    model: plan.model,
    permissionMode: plan.permissionMode,
    resumeRef: resumeSessionId ?? null,
    systemPrompt: combinedPrompt,
    mcpServers,
    debugLogPath,
    env,
    permissionPreHook,
    disallowedTools: automationDisallowedTools(sessionId),
  });

  // Construct the AgentSession now so event handlers can mutate it. The
  // handle's events fire on the next tick, so we have time to install the
  // session before any line lands.
  const agentSession: AgentSession = {
    agentId,
    sessionId,
    runner,
    handle,
    status: "idle",
    parentAgentId: parentAgentId ?? null,
    resultSummary: null,
    exitWaiters: [],
    turnWaiters: [],
    emitsSessionState: false,
    turnsCompleted: previous?.turnsCompleted ?? 0,
    suppressStatus: previous?.suppressStatus ?? false,
    createdAt: previous?.createdAt ?? Date.now(),
    lastEventAt: Date.now(),
    toolUsesTotal: previous?.toolUsesTotal ?? 0,
    costUsd: previous?.costUsd ?? 0,
    lastToolUseAt: previous?.lastToolUseAt ?? null,
    lastToolName: previous?.lastToolName ?? null,
    contextWindow: previous?.contextWindow ?? null,
    inflightPrompts: 0,
    model: plan.model,
    permissionMode: plan.permissionMode,
    accountId,
  };
  if (args.register) {
    appState.agents.set(agentId, agentSession);
  }

  // A resume spawn inherits a finished conversation: start it from saved
  // history so every client shows the prior turns instead of an empty chat.
  // Restore-at-turn is excluded: its agent already holds a deliberately
  // truncated transcript.
  if (resumeSessionId && !args.reused) {
    seedResumedConversation(agentId, argusSession.repo_root, resumeSessionId);
  }

  const eventChannel = `agent:event:${agentId}`;

  // -------------------------------------------------------------------------
  // Wire the runner's events to the existing IPC channels & vitals
  // -------------------------------------------------------------------------

  const noteRunFailure = (outcome: AuthOutcome): void => {
    if (outcome !== "rate_limited" && outcome !== "reauth") {
      return;
    }
    // Only the badge moving is worth a UI event — a spent quota repeats on
    // every retried line, and re-announcing it would re-run the auth prereq.
    if (!recordAuthOutcome(accountId, outcome)) {
      return;
    }
    warn(
      outcome === "rate_limited"
        ? `[agent:${agentId}] account ${accountId} hit its plan limit`
        : `[agent:${agentId}] account ${accountId} needs re-authentication`,
    );
    emitAccountsChanged();
  };

  handle.on("stderr", (line: string) => {
    // A dead refresh token only shows up here — surface it on the account so
    // Settings can offer a re-login instead of claiming it's signed in.
    noteRunFailure(classifyRunFailure(line));
    emitHostEvent(`agent:stderr:${agentId}`, line);
  });

  handle.on("permission-request", (payload: unknown) => {
    const p = payload as PermissionRequestPayload;
    if (p?.tool_use_id) {
      let pending = appState.agentPendingPermissions.get(agentId);
      if (!pending) {
        pending = new Map();
        appState.agentPendingPermissions.set(agentId, pending);
      }
      pending.set(p.tool_use_id, p);
    }
    emitHostEvent(`agent:permission:${agentId}`, payload);
  });

  handle.on("permission-cancel", (payload: unknown) => {
    const p = payload as { tool_use_id?: string };
    if (p?.tool_use_id) {
      appState.agentPendingPermissions.get(agentId)?.delete(p.tool_use_id);
    }
    emitHostEvent(`agent:permission-cancel:${agentId}`, payload);
  });

  handle.on("capabilities", (payload: unknown) => {
    rememberStartOptions(runner.id, payload);
    emitHostEvent(`agent:capabilities:${agentId}`, payload);
  });

  handle.on("stream-event", (line: string) => {
    // A revoked token or spent quota reaches us as an API error in the stream,
    // not on stderr. The cheap pre-gate skips parsing ordinary lines.
    if (line.includes('"error"') || line.includes('"is_error":true')) {
      const outcome = classifyStreamLine(line);
      noteRunFailure(outcome);
      if (outcome === "rate_limited") {
        noteLimitHit(agentId);
      }
    }
    if (line.includes('"rate_limit_event"')) {
      noteRateLimitLine(agentId, line);
      noteUsageRateLimitLine(accountId, line);
    }
    // The line goes out first so a `result` reaches clients before the idle
    // it can trigger.
    emitHostEvent(eventChannel, line);
    onStreamLine(agentId, line);
  });

  handle.on("exit", (exitCode: number) => {
    const agentEntry = appState.agents.get(agentId);
    // If the slot was reused by a respawn (restore-at-turn), this `child`
    // is the abandoned old handle. Drop the close event silently.
    if (agentEntry && agentEntry.handle !== handle) {
      info(`[agent:${agentId}] old child closed after respawn — ignored`);

      return;
    }
    // restoreAgentAtTurn awaits the old child's exit *before* respawning, so
    // when its close fires the slot still references this same child — the
    // mismatch guard above doesn't catch this window. Honor suppressStatus
    // here too: skip the stopped/error transition and the exit broadcast so
    // the frontend's running indicator stays lit until the new child is up.
    if (agentEntry?.suppressStatus) {
      info(`[agent:${agentId}] old child closed during restore — suppressed`);

      return;
    }
    if (agentEntry) {
      agentEntry.status = exitCode === 0 ? "stopped" : "error";

      for (const resolve of agentEntry.exitWaiters) {
        resolve(exitCode);
      }
      agentEntry.exitWaiters.length = 0;

      for (const resolve of agentEntry.turnWaiters) {
        resolve(agentEntry.status);
      }
      agentEntry.turnWaiters.length = 0;
    }

    simulatorPool.releaseSimulator(agentId).catch((e) => {
      warn(`[agent:${agentId}] simulator release failed: ${String(e)}`);
    });
    webBrowserPool.releaseBrowser(agentId).catch((e) => {
      warn(`[agent:${agentId}] web browser release failed: ${String(e)}`);
    });

    emitHostEvent(`agent:exit:${agentId}`, exitCode);
    info(`[agent:${agentId}] process exited with code ${exitCode}`);
    forgetLimitResume(agentId);

    // A clean exit proves the account works again, so a limit or re-auth badge
    // from an earlier run has to go — nothing else would lift it.
    if (exitCode === 0) {
      clearAuthFailure(accountId);
    }

    if (agentEntry) {
      telemetryCapture("agent_exited", {
        exit_code: exitCode,
        success: exitCode === 0,
        turns_completed: agentEntry.turnsCompleted,
        tool_uses: agentEntry.toolUsesTotal,
        duration_ms: Date.now() - agentEntry.createdAt,
      });
    }
  });

  return agentSession;
}

// ---------------------------------------------------------------------------
// Per-line vitals + status tracking (was inline in claude.ts readline loop)
// ---------------------------------------------------------------------------

export function onStreamLine(agentId: string, line: string): void {
  const session = appState.agents.get(agentId);
  if (!session) {
    return;
  }
  // Heartbeat: bump last-activity on every non-blank event.
  session.lastEventAt = Date.now();

  if (line.includes('"subtype":"init"')) {
    try {
      const parsed = JSON.parse(line) as { type?: string; model?: string };
      if (parsed.type === "system" && parsed.model) {
        session.resolvedModel = parsed.model;
      }
    } catch {
      // Non-fatal.
    }
  }

  // Tool-use heartbeat: cheap substring gate first.
  if (line.includes('"type":"tool_use"')) {
    try {
      const parsed = JSON.parse(line) as {
        type?: string;
        message?: { content?: { type?: string; name?: string }[] };
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
          session.toolUsesTotal += observed;
          session.lastToolUseAt = Date.now();
          if (latestName !== null) {
            session.lastToolName = latestName;
          }
        }
      }
    } catch {
      // Malformed line — drop the metric.
    }
  }

  // session_state_changed → status transitions + turn waiters.
  if (line.includes('"session_state_changed"')) {
    try {
      const parsed = JSON.parse(line) as {
        type?: string;
        subtype?: string;
        state?: string;
      };
      if (
        parsed.type === "system" &&
        parsed.subtype === "session_state_changed" &&
        session.status !== "stopped" &&
        session.status !== "error" &&
        (parsed.state === "idle" ||
          parsed.state === "running" ||
          parsed.state === "requires_action")
      ) {
        const prev = session.status;
        session.status = parsed.state;
        session.emitsSessionState = true;
        if (prev !== parsed.state) {
          emitAgentStatus(agentId, parsed.state);
        }
        // `result` counts turns; `idle` is the turn really being over — it
        // only lands once held-back results and background work have drained.
        if (parsed.state === "idle") {
          // A prompt written mid-turn joins that turn and gets no `result`
          // of its own; idle means every prompt has been answered.
          session.inflightPrompts = 0;
        }
        if (parsed.state === "idle" && prev !== "idle") {
          for (const resolve of session.turnWaiters) {
            resolve("idle");
          }
          session.turnWaiters.length = 0;
        }
      }
    } catch {
      // Non-fatal.
    }
  }

  // permissionMode changes reported by the CLI. The CLI owns its own mode and
  // announces every change here (e.g. it silently resets to "default" when a
  // plan is approved). Mirror it onto the session so the chip never drifts.
  // When the reset is the CLI's post-plan drop to "default", re-apply the mode
  // the user had before entering plan instead — a user who launched in `auto`
  // should not get demoted to ask-per-tool. Driving this off the CLI's own
  // signal (rather than a fire-and-forget call after the approval click) makes
  // it race-free.
  if (line.includes('"permissionMode"')) {
    try {
      const parsed = JSON.parse(line) as {
        type?: string;
        permissionMode?: string;
      };
      if (
        parsed.type === "system" &&
        typeof parsed.permissionMode === "string"
      ) {
        const canonical = toCanonicalPermissionMode(parsed.permissionMode);
        const leftPlan =
          session.permissionMode === "plan" && canonical === "ask";
        if (leftPlan) {
          const restore =
            session.prePlanPermissionMode ?? DEFAULT_AGENT_PERMISSION_MODE;
          session.prePlanPermissionMode = null;
          session.permissionMode = restore;
          emitHostEvent(`agent:permission-mode-changed:${agentId}`, restore);
          session.handle.setPermissionMode(restore).catch(() => {});
        } else if (canonical !== session.permissionMode) {
          session.permissionMode = canonical;
          emitHostEvent(`agent:permission-mode-changed:${agentId}`, canonical);
        }
      }
    } catch {
      // Non-fatal.
    }
  }

  // Capture final result event.
  if (line.includes('"result"') && line.includes('"type"')) {
    try {
      const parsed = JSON.parse(line) as {
        type?: string;
        subtype?: string;
        is_error?: boolean;
        result?: string;
        total_cost_usd?: number;
        duration_ms?: number;
        modelUsage?: unknown;
      };
      if (parsed.type === "result") {
        // Before the status change below, so the idle push carries it.
        const reported = contextWindowFromModelUsage(
          parsed.modelUsage,
          session.resolvedModel,
        );
        if (reported) {
          session.contextWindow = reported;
          if (session.resolvedModel) {
            rememberContextWindow(session.resolvedModel, reported);
          }
        }
        session.resultSummary = {
          subtype: resultSubtype(parsed),
          result: parsed.result,
          total_cost_usd: parsed.total_cost_usd ?? 0,
          duration_ms: parsed.duration_ms ?? 0,
        };
        session.costUsd += parsed.total_cost_usd ?? 0;
        if (session.inflightPrompts > 0) {
          session.inflightPrompts -= 1;
        }
        session.turnsCompleted += 1;
        // A `result` is not the agent going idle: background tasks can keep
        // it working afterwards. Only CLIs without state events fall back here.
        if (
          !session.emitsSessionState &&
          session.status !== "stopped" &&
          session.status !== "error"
        ) {
          const prev = session.status;
          session.status = "idle";
          if (prev !== "idle") {
            emitAgentStatus(agentId, "idle");
          }
          for (const resolve of session.turnWaiters) {
            resolve("idle");
          }
          session.turnWaiters.length = 0;
        }
        if (
          onTurnResult(agentId, (message) => sendAgentMessage(agentId, message))
        ) {
          noteLimitStallStarted(agentId);
        }
      }
    } catch {
      // Non-fatal.
    }
  }
}

// ---------------------------------------------------------------------------
// restore_agent_at_turn
// ---------------------------------------------------------------------------

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

  if (!session.runner.forkTranscript) {
    throw `Restore-at-turn is not supported by runner "${session.runner.id}"`;
  }

  const sessionId = session.sessionId;
  const argusSession = appState.sessions.get(sessionId);
  if (
    !argusSession ||
    (argusSession.kind !== "worktree" && argusSession.kind !== "project_root")
  ) {
    throw `Cannot restore agent in session kind "${argusSession?.kind ?? "unknown"}"`;
  }

  // Pin status to "running" + silence the emit channel.
  session.status = "running";
  session.suppressStatus = true;

  // Kill the old handle and wait for exit.
  const oldHandle = session.handle;
  await oldHandle.kill();
  oldHandle.cleanup();

  // Fork the transcript via the runner.
  let newClaudeSessionId: string | null = null;
  if (args.keepTurnNumber > 0) {
    const forked = await session.runner.forkTranscript({
      sourceCwd: argusSession.path,
      sourceRef: args.sourceClaudeSessionId,
      destCwd: argusSession.path,
      destBranch: argusSession.branch,
      cutoffTimestampMs: args.cutoffTimestampMs,
      keepTurnNumber: args.keepTurnNumber,
    });
    newClaudeSessionId = forked.resumeRef;
    if (!newClaudeSessionId) {
      session.suppressStatus = false;
      throw "Failed to truncate Claude session JSONL — nothing to resume";
    }

    // Delete the old JSONL now that the new one is written.
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

  // Respawn under the same agent slot. Passing `undefined` for model and
  // permission mode lets `startAgent` inherit both from the reused slot.
  await startAgent(
    sessionId,
    undefined,
    undefined,
    newClaudeSessionId ?? undefined,
    undefined,
    undefined,
    session.parentAgentId ?? undefined,
    args.agentId,
  );

  telemetryCapture("agent_restored", {
    is_fresh_start: args.keepTurnNumber === 0,
    keep_turn_number: args.keepTurnNumber,
  });

  const fresh = appState.agents.get(args.agentId);
  if (fresh) {
    fresh.suppressStatus = false;
    fresh.status = "running";
  }

  // Verify the truncated JSONL.
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

/**
 * A client's start, announced as `agent:started` so every window and paired
 * device picks it up. The result's id is the agent's: a taken spare keeps its
 * own rather than the client's optimistic one.
 */
export async function launchAgent(opts: {
  sessionId: string;
  model?: string;
  permissionMode?: string;
  resumeSessionId?: string;
  appendSystemPrompt?: string;
  agentId?: string;
  runnerId?: string;
  /** A fork seeds its own transcript, so it never takes the warm spare. */
  fresh?: boolean;
}): Promise<AgentInfo> {
  const agent = await startAgent(
    opts.sessionId,
    opts.model,
    opts.permissionMode,
    opts.resumeSessionId,
    opts.appendSystemPrompt,
    undefined,
    undefined,
    undefined,
    opts.agentId,
    opts.runnerId,
    !opts.fresh,
  );
  emitHostEvent("agent:started", agent);

  return agent;
}

// ---------------------------------------------------------------------------
// stop_agent
// ---------------------------------------------------------------------------

export async function stopAgent(agentId: string): Promise<void> {
  const session = appState.agents.get(agentId);
  if (!session) {
    throw `No agent found: ${agentId}`;
  }

  session.status = "stopped";

  await session.handle.kill();
  session.handle.cleanup();

  await simulatorPool.releaseSimulator(agentId);
  await webBrowserPool.releaseBrowser(agentId);

  appState.agents.delete(agentId);
  takeStagedConversation(agentId);
  appState.agentPendingPermissions.delete(agentId);
  clearQueue(agentId);
  forgetLimitResume(agentId);

  emitAgentStatus(agentId, "stopped");
  info(`[agent:${agentId}] stopped`);
  telemetryCapture("agent_stopped");
}

/**
 * Kill every live agent's runner subprocess. Intended for `before-quit`
 * cleanup so claude CLI children don't linger after Argus exits — they
 * occasionally ignore SIGTERM (blocked in MCP HTTP I/O) and pile up across
 * sessions. Best-effort and bounded by `handle.kill()`'s own backstop.
 */
export async function destroyAllAgents(): Promise<void> {
  clearSpares();
  const sessions = Array.from(appState.agents.values());
  if (sessions.length === 0) {
    return;
  }
  info("destroyAllAgents: killing %d agent(s)", sessions.length);
  await Promise.all(
    sessions.map(async (s) => {
      try {
        await s.handle.kill();
        s.handle.cleanup();
      } catch {
        // best-effort; we're shutting down
      }
    }),
  );
  appState.agents.clear();
}

// ---------------------------------------------------------------------------
// interrupt_agent
// ---------------------------------------------------------------------------

export async function interruptAgent(agentId: string): Promise<void> {
  const session = appState.agents.get(agentId);
  if (!session) {
    throw `No agent found: ${agentId}`;
  }
  if (session.status === "stopped" || session.status === "error") {
    return;
  }

  try {
    await session.handle.interrupt();
  } catch (e) {
    throw `Failed to interrupt agent ${agentId}: ${String(e)}`;
  }

  info(`[agent:${agentId}] interrupted`);
  telemetryCapture("agent_interrupted");
}

// ---------------------------------------------------------------------------
// wait_for_agent
// ---------------------------------------------------------------------------

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

  const sessions = agentIds.map((id) => {
    const s = appState.agents.get(id);
    if (!s) {
      throw `No agent found: ${id}`;
    }

    return { id, session: s };
  });

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

export interface ImageAttachment {
  data: string;
  media_type: string;
}

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
  cancelLimitResume(agentId);
  // The old child is being killed; stdin written now would be lost.
  const pendingRespawn = respawning.get(agentId);
  if (pendingRespawn) {
    pendingRespawn
      .then(() => sendAgentMessage(agentId, message, images))
      .catch((e) => {
        warn(`[agent:${agentId}] message after respawn failed: ${String(e)}`);
      });

    return;
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

  try {
    agentEntry.handle.send(message, images ?? []);
  } catch (e) {
    throw `Failed to write to agent stdin: ${String(e)}`;
  }

  agentEntry.inflightPrompts += 1;

  // Busy from the moment the prompt is injected, ahead of the CLI's own
  // `session_state_changed(running)`; its `idle` flips it back.
  if (agentEntry.status !== "running") {
    agentEntry.status = "running";
    emitAgentStatus(agentId, "running");
  }
}

// ---------------------------------------------------------------------------
// MCP system messages
// ---------------------------------------------------------------------------

export interface McpSystemMessagePayload {
  tool:
    | "create_session"
    | "send_agent_message"
    | "spawn_agent"
    | "spawn_agents_batch";
  message: string;
  images?: ImageAttachment[];
  parentAgentId?: string;
  parentLabel?: string;
  timestamp: number;
}

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
  emitHostEvent(`agent:mcp-message:${recipientAgentId}`, full);
}

// ---------------------------------------------------------------------------
// set_agent_model
// ---------------------------------------------------------------------------

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

  await session.handle.setModel(model);

  session.model = model;

  emitHostEvent(`agent:model-changed:${agentId}`, model);
  info(`[agent:${agentId}] model changed to ${model}`);
}

// ---------------------------------------------------------------------------
// set_agent_permission_mode
// ---------------------------------------------------------------------------

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

  await session.handle.setPermissionMode(mode);

  // Track plan-mode transitions so ExitPlanMode approval can restore the
  // mode the user was in beforehand. Without this, the CLI internally drops
  // to "default" after ExitPlanMode and the user gets prompted for every
  // edit until they re-toggle.
  const enteringPlan = mode === "plan" && session.permissionMode !== "plan";
  const leavingPlan = mode !== "plan" && session.permissionMode === "plan";
  if (enteringPlan) {
    session.prePlanPermissionMode = session.permissionMode ?? null;
  } else if (leavingPlan) {
    session.prePlanPermissionMode = null;
  }

  session.permissionMode = mode;

  emitHostEvent(`agent:permission-mode-changed:${agentId}`, mode);
  info(`[agent:${agentId}] permission mode changed to ${mode}`);
}

// ---------------------------------------------------------------------------
// set_agent_effort
// ---------------------------------------------------------------------------

export async function setAgentEffort(
  agentId: string,
  level: string | null,
): Promise<void> {
  const session = appState.agents.get(agentId);
  if (!session) {
    throw `No agent found: ${agentId}`;
  }
  if (session.status === "stopped" || session.status === "error") {
    throw `Agent is not running: ${agentId}`;
  }

  await session.handle.setEffort(level);
  session.effort = level;

  emitHostEvent(`agent:effort-changed:${agentId}`, level);
  info(`[agent:${agentId}] effort changed to ${level ?? "(default)"}`);
}

// ---------------------------------------------------------------------------
// list_agents
// ---------------------------------------------------------------------------

export function listAgents(sessionId: string): AgentInfo[] {
  const result: AgentInfo[] = [];
  for (const session of appState.agents.values()) {
    if (session.sessionId === sessionId) {
      result.push({
        agent_id: session.agentId,
        session_id: session.sessionId,
        status: session.status,
        parent_agent_id: session.parentAgentId,
        created_at: session.createdAt,
        model: session.model,
        runner_id: session.runner.id,
      });
    }
  }

  return result;
}

/** Agents between kill and respawn; messages for them wait for the new child. */
const respawning = new Map<string, Promise<void>>();

/**
 * Restart an agent in place so it picks up new spawn-time settings — a runner
 * or Claude account switch. The agent id is reused so the tab and conversation
 * slot survive the swap, and the runner already stamped on the slot is what
 * the new subprocess spawns under. `keepModel` holds on to the model, which
 * only a runner switch invalidates; `resumeRef` carries the conversation over.
 */
export async function respawnAgent(
  agentId: string,
  opts: { keepModel?: boolean; resumeRef?: string } = {},
): Promise<void> {
  const session = appState.agents.get(agentId);
  if (!session) {
    return;
  }
  const { sessionId, parentAgentId } = session;

  // Silence the kill → spawn status flicker in the UI.
  session.suppressStatus = true;
  if (!opts.keepModel) {
    // The old runner's model id means nothing to the new one; drop it so the
    // spawn cascade falls through to the runner default.
    session.model = null;
  }

  const done = (async () => {
    await session.handle.kill();
    session.handle.cleanup();

    await startAgent(
      sessionId,
      undefined,
      undefined,
      opts.resumeRef,
      undefined,
      undefined,
      parentAgentId ?? undefined,
      agentId,
    );
  })();
  respawning.set(agentId, done);
  try {
    await done;
  } catch (e) {
    // The old child is gone and its exit was suppressed — don't leave the
    // slot looking alive.
    if (appState.agents.get(agentId) === session) {
      session.status = "error";
      session.suppressStatus = false;
      emitAgentStatus(agentId, "error");
    }
    throw e;
  } finally {
    respawning.delete(agentId);
    const fresh = appState.agents.get(agentId);
    if (fresh) {
      fresh.suppressStatus = false;
    }
  }
}

// ---------------------------------------------------------------------------
// respond_to_permission
// ---------------------------------------------------------------------------

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

  // Two attached clients can answer the same prompt; only the first reply may
  // reach the runner, a second write would desync its control protocol. Still
  // re-broadcast so the loser's UI clears.
  const pending = appState.agentPendingPermissions.get(agentId);
  if (pending && !pending.has(toolUseId)) {
    emitHostEvent(`agent:permission-resolved:${agentId}`, {
      tool_use_id: toolUseId,
      decision,
    });

    return;
  }

  try {
    session.handle.respondToPermission({
      toolUseId,
      decision,
      allowRule,
      allowAll,
      denyMessage,
    });
  } catch (e) {
    throw `Failed to write permission response to agent stdin: ${String(e)}`;
  }

  appState.agentPendingPermissions.get(agentId)?.delete(toolUseId);

  // Tell the renderer the prompt was answered so it clears the pending state
  // and republishes the snapshot. Essential when a remote (web) client answers:
  // otherwise the renderer never learns and the tool call stays "awaiting
  // permission" forever, on the desktop and in the mirrored remote transcript.
  emitHostEvent(`agent:permission-resolved:${agentId}`, {
    tool_use_id: toolUseId,
    decision,
  });
}

// ---------------------------------------------------------------------------
// Helpers — runtime section + status emission
// ---------------------------------------------------------------------------

interface RuntimeContext {
  platforms: Set<RuntimePlatform>;
  iosReservation: SimulatorReservation | null;
  androidDevices: AndroidDeviceSession[];
  browserSession: BrowserSession | null;
  browserUrl: string | null;
}

function buildRuntimeSection(ctx: RuntimeContext): string {
  const {
    platforms,
    iosReservation,
    androidDevices,
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
    if (androidDevices.length > 0) {
      for (const d of androidDevices) {
        lines.push(
          `An Android ${d.type} **${d.deviceName}** (serial \`${d.serial}\`) is booted. Target it with \`conductor <command> --device ${d.serial}\`.`,
        );
      }
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
    // `browserSession` is the live attachment signal — `platforms` only means
    // the project targets web, not that a browser view is actually mounted.
    const intro = browserSession
      ? `A web browser view is attached to your session${browserDefault}. A live CDP session is already wired to this session's webview. The user can see this browser view in the runtime panel. When the user asks about "the website", "the page", or "what site we're on", they are referring to this web browser view.`
      : `This project targets the web. A web browser view is not currently attached to your session — the user can open one in the runtime panel${browserDefault ? ` (it defaults to **${browserUrl}**)` : ""}. Once a browser view is open, the commands below work against it. When the user asks about "the website" or "the page", they mean that browser view.`;
    lines.push(
      "",
      "### Web Browser",
      "",
      intro,
      "",
      "To interact with the web browser view, use `conductor` with `--device web`:",
      "- `conductor inspect --device web` — see what's on the web page (ARIA tree, element names)",
      "- `conductor capture-ui --device web` — screenshot + ARIA tree in one call (prefer this when you need both)",
      "- `conductor take-screenshot --device web` — viewport screenshot. Add `--full-page` to capture the entire scrollable document in one image.",
      '- `conductor tap-on "element" --device web` — click an element in the web page',
      '- `conductor input-text "text" --device web` — type text into the focused field',
      "- `conductor open-link <url> --device web` — navigate the web browser to a URL",
      "- `conductor set-viewport --preset mobile|tablet|desktop --device web` (or explicit `--width N --height N`) — resize the browser viewport. Useful for responsive checks; the current URL is preserved across the resize, so one browser session can be screenshotted at multiple form factors.",
      "",
      "Argus wires `--device web` directly to this session's webview via CDP — conductor does **not** spawn a separate browser window. If the webview is reloaded or the runtime panel is torn down, run `conductor daemon-stop --device web` once to clear the stale connection; the next command will reconnect automatically.",
      "",
      "This repo may already ship tooling that emulates a browser (e.g. a dev server with a headless Chrome/Playwright/Puppeteer instance, or an existing CDP-exposing process). Prefer connecting `conductor` to such an emulator over CDP rather than spawning a new web browser — reuse the running instance instead of standing up a duplicate.",
    );
  }

  lines.push("", "### Using conductor", "");
  lines.push(
    "Use the `conductor` CLI to interact with and observe all runtime views. Run `conductor --help` for usage, or `conductor workspace info` to auto-detect the project type, bundle IDs, Metro port, and available devices before you start.",
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
      "- `conductor capture-ui --output <path>` — one shot: screenshot + accessibility hierarchy + a11y snapshot. **Prefer this over separate `take-screenshot` + `inspect` calls** when you need both the image and the element tree; it's faster and one round-trip.",
      "- `conductor take-screenshot --output <path>` — just the image. Read the file back to see it.",
      "- `conductor inspect` — just the accessibility tree (element IDs, labels, text). Add `--at <x,y>` to query the topmost element at a point.",
      '- `conductor tap-on "<element>"` — tap by text/accessibility label. Supports relational matchers (`--below`, `--right-of`, …) and state filters (`--enabled`, `--focused`).',
      '- `conductor input-text "<text>"` — type into the focused text field.',
      "- `conductor swipe <direction>` / `conductor scroll <direction>` / `conductor scroll-until-visible <element>` — navigate lists and scroll views.",
      "- `conductor foreground-app` — print the bundle ID / package name of the app currently in foreground.",
      "- `conductor launch-app <bundleId>` — launch. Add `--clear-state` to reset app data, `--clear-keychain` (iOS) to wipe credentials, `--argument key=value` to pass launch args.",
      '- `conductor assert-visible "<element>"` / `assert-not-visible "<element>"` — quick invariants for tests.',
      "- `conductor hide-keyboard` — dismiss the on-screen keyboard.",
      "",
      '**Batching multi-step interactions:** when you need to drive several steps in a row (tap → tap → input → assert), prefer `conductor run-sequence --file plan.json` over a chain of individual Bash calls. The JSON shape is `{"steps":[{"cmd":"tap-on","args":["Login"]}, …]}`; it runs serially against one session and stops on the first failure. Many fewer process spawns, much cheaper on tokens, and the failure point is unambiguous.',
      "",
      "**React Native projects:** after editing JS, run `conductor metro reload` to refresh the bundle without restarting native — much faster than rebuilding. `conductor metro stop` kills the bundler if you need a clean restart. For debugging the running app, `conductor debug evaluate '<expr>'` runs JS in the Hermes/Fusebox runtime, `conductor debug component-tree` prints the React tree, and `conductor network logs` shows recent HTTP traffic.",
      "",
      "**When something breaks:** `conductor logs --recent 200` (or `--source metro` / `--source device`) for app/device logs without leaving anything streaming. `conductor crashes list` / `conductor crashes show <id>` for native crashes. `conductor capture-ui` to confirm what's actually on screen right now.",
      "",
      "**Recording flows:** if you want to capture an interaction as a reproducible YAML flow, `conductor flow record start --out path.yaml`, drive the app (manually or via more conductor commands), then `conductor flow record finish`. Replay later with `conductor run-flow path.yaml`.",
      "",
      "When validating UI changes, capture the before/after state and compare. If the project has reference screenshots or a design spec (commonly under `legacy/`, `docs/`, or referenced in the project config), compare against those rather than relying on memory.",
    );
  }

  lines.push(
    "",
    "When the user asks about what they see, what's on screen, or what the app/website is showing, use conductor to answer from the device's current state.",
  );

  return lines.join("\n");
}

function emitAgentStatus(agentId: string, status: AgentStatusValue): void {
  const session = appState.agents.get(agentId);
  if (session?.suppressStatus) {
    return;
  }
  emitHostEvent(`agent:status:${agentId}`, status);
}
