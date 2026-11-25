/**
 * A teammate's conversations. Each thread is one agent in a neutral session
 * of its own folder, so the runner's newest transcript there is the thread's
 * — which is how a thread resumes after a restart with nothing else tracked.
 * The agent keeps the thread's id-derived agent id across restarts, so a
 * client holding it keeps working.
 */

import type { TeammateThreadFailure } from "./failure";
import type { Teammate } from "./models";
import type { Session } from "../session/models";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { emitHostEvent } from "@argus/host/bus";
import { info } from "@argus/host/logger";
import { appState } from "../../state";
import { loadAppSettings } from "../appSettings/store";
import { resolveHostAutonomy } from "../automation/autonomy";
import { readEnvelope, writeJson } from "../automation/jsonFile";
import { getRunnerById } from "../llm/registry";
import { resolveRunnerForSession } from "../llm/resolve";
import { ensureRepoRegistered } from "../mcp/projects";
import { DEFAULT_RUNNER_ID, sessionRunnerId } from "../session/models";
import { capture as telemetryCapture } from "../telemetry/telemetry";
import { teammateChatAutomation } from "./chatPolicy";
import { deleteTeammate, dutiesOf, requireTeammate } from "./manager";
import { teammateDir, teammateThreadsFilePath } from "./paths";
import { buildTeammatePrompt } from "./prompt";
import { threadRolloverTurns } from "./settings";
import {
  forgetThreadSession,
  onThreadMessage,
  registerThreadSession,
  threadSessionId,
} from "./threadSessions";

const SCHEMA_VERSION = 1;
/** Threads kept per teammate; the oldest archived ones go first. */
export const MAX_THREADS_PER_TEAMMATE = 200;

export type ThreadSurface = "direct" | "handoff" | "linear" | "slack";

export interface TeammateThread {
  id: string;
  teammate_id: string;
  /** Where it started: the app, Slack, a Linear comment, or another teammate. */
  surface: ThreadSurface;
  /** The first thing the user said, trimmed. Shown in the thread list only. */
  title: string;
  /** Stable across restarts; the live agent, when one runs, has this id. */
  agent_id: string;
  created_at: number;
  last_opened_at: number;
  archived: boolean;
  /** Why the last turn stopped short; cleared when the next one starts. */
  failure?: TeammateThreadFailure | null;
}

/** What the host keeps beside the wire shape, to notice an unfinished turn. */
export interface StoredThread extends TeammateThread {
  /** A turn started and hasn't ended; survives a host crash. */
  inflight_since?: number | null;
  /** Restarts that picked this turn back up; reset once a turn ends. */
  auto_resumes?: number;
}

function toWire(thread: StoredThread): TeammateThread {
  const {
    inflight_since: _inflight,
    auto_resumes: _autoResumes,
    ...wire
  } = thread;

  return wire;
}

let cache: StoredThread[] | null = null;

function threads(): StoredThread[] {
  cache ??= readEnvelope<StoredThread>(
    teammateThreadsFilePath(),
    "teammate-threads.json",
    "threads",
    SCHEMA_VERSION,
  );

  return cache;
}

function persist(): void {
  const byTeammate = new Map<string, StoredThread[]>();
  for (const thread of threads()) {
    const list = byTeammate.get(thread.teammate_id) ?? [];
    list.push(thread);
    byTeammate.set(thread.teammate_id, list);
  }
  const keep = new Set<string>();
  for (const list of byTeammate.values()) {
    list
      .sort(
        (a, b) =>
          Number(a.archived) - Number(b.archived) ||
          b.last_opened_at - a.last_opened_at,
      )
      .slice(0, MAX_THREADS_PER_TEAMMATE)
      .forEach((t) => keep.add(t.id));
  }
  cache = threads().filter((t) => keep.has(t.id));
  writeJson(teammateThreadsFilePath(), {
    version: SCHEMA_VERSION,
    threads: cache,
  });
  emitHostEvent("teammate_threads:changed", {});
}

/** The stored record, for the turn tracking in `./recovery` to update. */
export function threadRecord(threadId: string): StoredThread | null {
  return threads().find((t) => t.id === threadId) ?? null;
}

/** Threads a crash or restart left mid-turn. */
export function interruptedThreads(): StoredThread[] {
  return threads().filter((t) => !t.archived && t.inflight_since);
}

export function saveThreads(): void {
  persist();
}

/** Test seam. */
export function resetThreadCache(): void {
  cache = null;
}

export function threadDir(teammateId: string, threadId: string): string {
  return path.join(teammateDir(teammateId), "threads", threadId);
}

export function listThreads(teammateId: string): TeammateThread[] {
  requireTeammate(teammateId);

  return threads()
    .filter((t) => t.teammate_id === teammateId && !t.archived)
    .sort((a, b) => b.last_opened_at - a.last_opened_at)
    .map(toWire);
}

/** The pin applies only on the default runner. */
function pinnedAccount(runnerId: string, teammate: Teammate): string | null {
  return runnerId === DEFAULT_RUNNER_ID ? teammate.claude_account_id : null;
}

function threadSession(teammate: Teammate, thread: TeammateThread): Session {
  const dir = threadDir(teammate.id, thread.id);
  const appDefault = loadAppSettings().default_llm ?? undefined;
  const { runner, defaultModel } = resolveRunnerForSession({
    repoRoot: dir,
    explicit: { runner: teammate.runner, model: teammate.model },
    appDefault,
  });

  return {
    id: threadSessionId(thread.id),
    kind: "automation_host",
    branch: "",
    display_name: teammate.name,
    description: thread.title,
    path: dir,
    repo_root: dir,
    status: "ready",
    env_index: null,
    base_branch: null,
    runner_id: runner.id,
    model: defaultModel ?? appDefault?.model?.trim() ?? null,
    claude_account_id: pinnedAccount(runner.id, teammate),
  };
}

function ensureSession(teammate: Teammate, thread: TeammateThread): Session {
  const id = threadSessionId(thread.id);
  const existing = appState.sessions.get(id);
  if (existing) {
    return existing;
  }
  fs.mkdirSync(threadDir(teammate.id, thread.id), { recursive: true });
  const session = threadSession(teammate, thread);
  appState.sessions.set(id, session);
  registerThreadSession(id, teammate.id, thread.id);
  emitHostEvent("session:created", { ...session });

  return session;
}

export interface OpenedThread {
  thread: TeammateThread;
  agent_id: string;
  session_id: string;
}

/**
 * The thread to talk in — the newest one, a specific one, or a fresh one —
 * with its agent running or paused and ready for a message.
 */
export async function openThread(
  teammateId: string,
  options: {
    threadId?: string | null;
    fresh?: boolean;
    surface?: ThreadSurface;
  } = {},
): Promise<OpenedThread> {
  const teammate = requireTeammate(teammateId);
  let thread: StoredThread | undefined;
  if (options.threadId) {
    thread = threads().find(
      (t) => t.id === options.threadId && t.teammate_id === teammateId,
    );
    if (!thread) {
      throw `Thread not found: ${options.threadId}`;
    }
  } else if (!options.fresh) {
    thread = threads().find((t) => t.id === listThreads(teammateId)[0]?.id);
    // A long conversation is left for a fresh one; what mattered is in memory.
    const turns = thread
      ? appState.agents.get(thread.agent_id)?.turnsCompleted
      : 0;
    if (turns !== undefined && turns >= threadRolloverTurns()) {
      thread = undefined;
    }
  }

  const isNew = !thread;
  if (!thread) {
    const id = crypto.randomUUID();
    thread = {
      id,
      teammate_id: teammateId,
      surface: options.surface ?? "direct",
      title: "",
      agent_id: `teammate-${id}`,
      created_at: Date.now(),
      last_opened_at: Date.now(),
      archived: false,
    };
    threads().push(thread);
  }
  thread.last_opened_at = Date.now();
  thread.archived = false;
  persist();

  const session = ensureSession(teammate, thread);
  let resumed = false;
  if (!appState.agents.has(thread.agent_id)) {
    resumed = await startThreadAgent(teammate, thread, session);
  }
  telemetryCapture("teammate_thread_opened", { new_thread: isNew, resumed });

  return {
    thread: toWire(thread),
    agent_id: thread.agent_id,
    session_id: session.id,
  };
}

/** Start the thread's agent, resuming its transcript when there is one. */
async function startThreadAgent(
  teammate: Teammate,
  thread: TeammateThread,
  session: Session,
): Promise<boolean> {
  for (const repoRoot of teammate.scope.repo_roots) {
    try {
      ensureRepoRegistered(repoRoot);
    } catch (e) {
      info(`teammate ${teammate.id}: skipping ${repoRoot}: ${String(e)}`);
    }
  }
  const runner = getRunnerById(sessionRunnerId(session));
  const resumeRef =
    (await runner?.latestTranscriptRef?.(session.path ?? "")) ?? undefined;
  const autonomy = resolveHostAutonomy(teammateChatAutomation(teammate));
  const permissionMode = autonomy === "propose" ? "plan" : "default";

  // Lazy: the agent service reaches back into the automation guards, which
  // read teammates — a module-scope import would close that cycle.
  const { startAgent } = await import("../agent/agentService");
  const agent = await startAgent(
    session.id,
    teammate.model ?? undefined,
    permissionMode,
    resumeRef,
    buildTeammatePrompt(
      teammate,
      dutiesOf(teammate.id).map((d) => d.id),
    ),
    undefined,
    undefined,
    undefined,
    thread.agent_id,
    undefined,
    false,
  );
  emitHostEvent("agent:started", {
    agent_id: agent.agent_id,
    session_id: agent.session_id,
    status: agent.status,
    permission_mode: permissionMode,
    parent_agent_id: agent.parent_agent_id,
    created_at: agent.created_at,
    model: agent.model,
  });

  return resumeRef !== undefined;
}

/** Name a thread after the first thing said in it. */
onThreadMessage((threadId, text) => titleThread(threadId, text));

export function titleThread(threadId: string, text: string): void {
  const thread = threads().find((t) => t.id === threadId);
  if (!thread || thread.title) {
    return;
  }
  thread.title = text.replace(/\s+/g, " ").trim().slice(0, 80);
  persist();
}

export async function archiveThread(threadId: string): Promise<void> {
  const thread = threads().find((t) => t.id === threadId);
  if (!thread) {
    throw `Thread not found: ${threadId}`;
  }
  thread.archived = true;
  persist();
  const sessionId = threadSessionId(threadId);
  if (appState.agents.has(thread.agent_id)) {
    const { stopAgent } = await import("../agent/agentService");
    await stopAgent(thread.agent_id);
  }
  if (appState.sessions.delete(sessionId)) {
    emitHostEvent("session:deleted", sessionId);
  }
  forgetThreadSession(sessionId);
}

/** Delete a teammate, stopping its conversations first. */
export async function deleteTeammateWithThreads(
  teammateId: string,
  keepDuties: boolean,
): Promise<void> {
  requireTeammate(teammateId);
  for (const thread of threads().filter((t) => t.teammate_id === teammateId)) {
    await archiveThread(thread.id);
  }
  cache = threads().filter((t) => t.teammate_id !== teammateId);
  persist();
  deleteTeammate(teammateId, keepDuties);
}

const ANSWER_TIMEOUT_MS = 20 * 60_000;

/**
 * Say something in a thread — a new one when `threadId` is null — and wait
 * for the answer to that turn. For surfaces that need a reply in hand: a
 * Linear comment, another teammate.
 */
export async function askTeammate(
  teammateId: string,
  ask: {
    threadId: string | null;
    surface: ThreadSurface;
    text: string;
    author: string;
    timeoutMs?: number;
  },
): Promise<{ threadId: string; agentId: string; answer: string | null }> {
  const opened = await openThread(teammateId, {
    threadId: ask.threadId,
    fresh: ask.threadId === null,
    surface: ask.surface,
  });
  const before = appState.agents.get(opened.agent_id)?.turnsCompleted ?? 0;
  const { submitAgentMessage } = await import("../agent/conversation/actions");
  await submitAgentMessage(opened.agent_id, {
    text: ask.text,
    author: ask.author,
  });

  return {
    threadId: opened.thread.id,
    agentId: opened.agent_id,
    answer: await nextAnswer(
      opened.agent_id,
      before,
      ask.timeoutMs ?? ANSWER_TIMEOUT_MS,
    ),
  };
}

/** The result of the first turn after `before`, or null on timeout. */
async function nextAnswer(
  agentId: string,
  before: number,
  timeoutMs: number,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const agent = appState.agents.get(agentId);
    if (!agent) {
      return null;
    }
    if (agent.turnsCompleted > before && agent.status !== "running") {
      return agent.resultSummary?.result ?? null;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  return null;
}
