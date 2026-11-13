/**
 * The worktree cleanup: a dry run for Settings, "Clean up now", and the
 * scheduled sweep. Every path goes through `planCleanup`, so the preview is
 * exactly what a sweep removes.
 */

import type { InspectedWorktree } from "./plan";
import type {
  WorktreeCleanupEntry,
  WorktreeCleanupPolicy,
  WorktreeCleanupPreview,
  WorktreeCleanupSweep,
} from "@argus/remote-protocol";
import { addHostEventSink, emitHostEvent } from "@argus/host/bus";
import { createLogger } from "@argus/host/logger";
import { appState } from "../../state";
import { isAgentBusy } from "../agent/busy";
import { loadAppSettings } from "../appSettings/store";
import { deleteSession, listSessions } from "../session/manager";
import { capture as telemetryCapture } from "../telemetry/telemetry";
import {
  chatActivityByRepo,
  inspectWorktree,
  isCleanupCandidate,
} from "./inspect";
import { planCleanup, removable } from "./plan";
import { loadCleanupState, markLanded, saveCleanupState } from "./state";
import { bucketBytes, bucketCount, cleanupMessage } from "./summary";

const log = createLogger("worktreeCleanup");

const FIRST_SWEEP_MS = 10 * 60_000;
const SWEEP_INTERVAL_MS = 6 * 60 * 60_000;
const INSPECT_CONCURRENCY = 4;

export function cleanupPolicy(): WorktreeCleanupPolicy {
  const s = loadAppSettings();

  return {
    enabled: s.worktree_cleanup_enabled ?? false,
    landed_days: s.worktree_cleanup_landed_days ?? 7,
    idle_days: s.worktree_cleanup_idle_days ?? 30,
    max_gb: s.worktree_cleanup_max_gb ?? 0,
  };
}

async function mapLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    },
  );
  await Promise.all(workers);

  return out;
}

async function inspectAll(): Promise<InspectedWorktree[]> {
  for (const root of appState.repoRoots) {
    await listSessions(root).catch((e) =>
      log.warn(`couldn't list sessions for a project:`, e),
    );
  }
  const sessions = [...appState.sessions.values()].filter(isCleanupCandidate);

  const state = loadCleanupState();
  const now = Date.now();
  let changed = false;
  for (const s of sessions) {
    const pr = s.pull_request?.state;
    if (
      (pr === "merged" || pr === "closed") &&
      state.landed[s.id] === undefined
    ) {
      state.landed[s.id] = now;
      changed = true;
    }
  }
  if (changed) {
    saveCleanupState(state);
  }

  const chats = new Map<string, Map<string, number>>();
  for (const s of sessions) {
    if (!chats.has(s.repo_root)) {
      chats.set(s.repo_root, chatActivityByRepo(s.repo_root));
    }
  }

  return mapLimited(sessions, INSPECT_CONCURRENCY, (s) =>
    inspectWorktree(s, state.landed[s.id] ?? null, chats.get(s.repo_root)!),
  );
}

export async function previewCleanup(): Promise<WorktreeCleanupPreview> {
  const policy = cleanupPolicy();
  const plan = planCleanup(await inspectAll(), policy, Date.now());

  return {
    policy,
    entries: plan.entries,
    total_bytes: plan.total_bytes,
    last_sweep: loadCleanupState().last_sweep,
  };
}

let running: Promise<WorktreeCleanupSweep> | null = null;

/** One sweep at a time: a second request joins the one in flight. */
export function runCleanup(
  trigger: WorktreeCleanupSweep["trigger"],
): Promise<WorktreeCleanupSweep> {
  running ??= sweep(trigger).finally(() => {
    running = null;
  });

  return running;
}

async function sweep(
  trigger: WorktreeCleanupSweep["trigger"],
): Promise<WorktreeCleanupSweep> {
  const plan = planCleanup(await inspectAll(), cleanupPolicy(), Date.now());
  const removed: WorktreeCleanupEntry[] = [];
  let failed = 0;
  for (const entry of removable(plan.entries)) {
    // Re-checked at the moment of removal: an agent may have started since.
    const live = appState.sessions.get(entry.session_id);
    if (!live || !isCleanupCandidate(live) || agentStarted(entry.session_id)) {
      continue;
    }
    try {
      await deleteSession(entry.session_id, false);
      removed.push(entry);
    } catch (e) {
      failed += 1;
      log.warn(`couldn't remove a worktree:`, e);
    }
  }

  const result: WorktreeCleanupSweep = {
    at: Date.now(),
    trigger,
    removed,
    freed_bytes: removed.reduce((sum, e) => sum + (e.bytes ?? 0), 0),
    failed,
  };

  const state = loadCleanupState();
  state.last_sweep = result;
  // Forget sessions that are gone, so the file doesn't grow forever.
  state.landed = Object.fromEntries(
    Object.entries(state.landed).filter(
      ([id]) =>
        appState.sessions.has(id) && !removed.some((e) => e.session_id === id),
    ),
  );
  saveCleanupState(state);

  log.info(
    `${trigger} sweep removed ${removed.length} worktree(s), ${failed} failed`,
  );
  if (removed.length > 0 || failed > 0) {
    emitHostEvent("worktrees:cleaned", {
      ...result,
      message: cleanupMessage(result),
    });
  }
  if (trigger === "manual" || removed.length > 0 || failed > 0) {
    telemetryCapture("worktree_cleanup_swept", {
      trigger,
      removed_bucket: bucketCount(removed.length),
      freed_bucket: bucketBytes(result.freed_bytes),
      protected_bucket: bucketCount(
        plan.entries.filter((e) => e.blocked_by !== null).length,
      ),
      failed: failed > 0,
    });
  }

  return result;
}

function agentStarted(sessionId: string): boolean {
  return [...appState.agents.values()].some(
    (agent) => agent.sessionId === sessionId && isAgentBusy(agent),
  );
}

let first: ReturnType<typeof setTimeout> | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
let removeSink: (() => void) | null = null;

function scheduledSweep(): void {
  if (!cleanupPolicy().enabled) {
    return;
  }
  runCleanup("scheduled").catch((e) => log.error("scheduled sweep failed:", e));
}

export function startWorktreeCleanup(): void {
  removeSink = addHostEventSink((channel, args) => {
    const payload = args[0] as { sessionId?: unknown } | undefined;
    if (
      channel === "session:merged" &&
      typeof payload?.sessionId === "string"
    ) {
      markLanded(payload.sessionId);
    }
  });
  first = setTimeout(scheduledSweep, FIRST_SWEEP_MS);
  ticker = setInterval(scheduledSweep, SWEEP_INTERVAL_MS);
  first.unref?.();
  ticker.unref?.();
}

export function stopWorktreeCleanup(): void {
  removeSink?.();
  removeSink = null;
  if (first) {
    clearTimeout(first);
  }
  if (ticker) {
    clearInterval(ticker);
  }
  first = null;
  ticker = null;
}
