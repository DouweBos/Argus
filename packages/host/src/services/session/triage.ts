/**
 * How a session sorts in the clients' lists: marked done (or back from done),
 * snoozed until a time, and whether a turn finished while nobody was looking.
 * `$ARGUS_HOME/session-triage.json`, keyed by session id. A snooze that runs
 * out clears itself and notifies, so the session comes back on its own.
 */

import path from "node:path";
import { addHostEventSink, emitHostEvent } from "@argus/host/bus";
import { warn } from "@argus/host/logger";
import { argusHomeDir } from "../../lib/argusHome";
import { appState } from "../../state";
import { readEnvelope, writeJson } from "../automation/jsonFile";
import { capture as telemetryCapture } from "../telemetry/telemetry";

const SCHEMA_VERSION = 1;
/** setTimeout's ceiling; a longer snooze re-arms when this one fires. */
const MAX_TIMER_MS = 2 ** 31 - 1;
const MISSING_RETRY_MS = 30_000;
const MISSING_RETRIES = 10;

interface TriageRecord {
  id: string;
  /** Overrides the PR-derived default: true done, false kept active. */
  settled?: boolean;
  /** Epoch ms the session comes back. */
  snoozed_until?: number;
  unread?: boolean;
}

/** What a session listing carries. */
export interface SessionTriage {
  settled: boolean | null;
  snoozed_until: number | null;
  unread: boolean;
}

let records: Map<string, TriageRecord> | null = null;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let removeSink: (() => void) | null = null;

function filePath(): string {
  return path.join(argusHomeDir(), "session-triage.json");
}

function load(): Map<string, TriageRecord> {
  records ??= new Map(
    readEnvelope<TriageRecord>(
      filePath(),
      "session triage",
      "sessions",
      SCHEMA_VERSION,
    ).map((r) => [r.id, r]),
  );

  return records;
}

function save(): void {
  const all = [...load().values()].filter(
    (r) => r.settled !== undefined || r.snoozed_until !== undefined || r.unread,
  );
  writeJson(filePath(), { version: SCHEMA_VERSION, sessions: all });
}

function patch(id: string, change: Partial<Omit<TriageRecord, "id">>): void {
  const all = load();
  const merged = { ...(all.get(id) ?? { id }), ...change };
  // An undefined field is a cleared one: dropped, not written as a key.
  const next = Object.fromEntries(
    Object.entries(merged).filter(([, value]) => value !== undefined),
  ) as unknown as TriageRecord;
  all.set(id, next);
  save();
  emitHostEvent("session:updated", { id });
}

export function sessionTriage(id: string): SessionTriage {
  const r = load().get(id);

  return {
    settled: r?.settled ?? null,
    snoozed_until: r?.snoozed_until ?? null,
    unread: r?.unread === true,
  };
}

function requireSession(id: string): void {
  if (!appState.sessions.has(id)) {
    throw `Session not found: ${id}`;
  }
}

/** Mark done, keep active, or (null) go back to following the pull request. */
export function setSessionSettled(id: string, settled: boolean | null): void {
  requireSession(id);
  patch(id, {
    settled: settled ?? undefined,
    // Done is a decision about it: nothing left to read.
    ...(settled === true ? { unread: undefined } : {}),
  });
  telemetryCapture("session_triaged", {
    action: settled === true ? "settled" : "unsettled",
  });
}

/** Hide it until `until` (epoch ms), or bring it back now with null. */
export function snoozeSession(id: string, until: number | null): void {
  requireSession(id);
  if (until !== null && until <= Date.now()) {
    throw "Pick a time in the future";
  }
  patch(id, { snoozed_until: until ?? undefined });
  arm(id);
  telemetryCapture(
    "session_triaged",
    until === null
      ? { action: "unsnoozed" }
      : { action: "snoozed", duration_bucket: durationBucket(until) },
  );
}

/** A turn ended in it while no client had it open. */
export function markSessionUnread(id: string): void {
  if (load().get(id)?.unread || !appState.sessions.has(id)) {
    return;
  }
  patch(id, { unread: true });
}

/** A client opened it. */
export function markSessionRead(id: string): void {
  if (!load().get(id)?.unread) {
    return;
  }
  patch(id, { unread: undefined });
}

export function durationBucket(until: number): "<1d" | "<1w" | "<4h" | "1w+" {
  const hours = (until - Date.now()) / 3_600_000;
  if (hours < 4) {
    return "<4h";
  }
  if (hours < 24) {
    return "<1d";
  }

  return hours < 24 * 7 ? "<1w" : "1w+";
}

function arm(id: string): void {
  clearTimeout(timers.get(id));
  timers.delete(id);
  const until = load().get(id)?.snoozed_until;
  if (until === undefined) {
    return;
  }
  const delay = Math.max(0, until - Date.now());
  timers.set(
    id,
    setTimeout(
      () => (delay > MAX_TIMER_MS ? arm(id) : wake(id)),
      Math.min(delay, MAX_TIMER_MS),
    ),
  );
}

function wake(id: string, attempt = 0): void {
  timers.delete(id);
  const session = appState.sessions.get(id);
  if (!session) {
    // At boot its project may not be listed yet; one deleted while the host was down never is.
    if (attempt < MISSING_RETRIES) {
      timers.set(
        id,
        setTimeout(() => wake(id, attempt + 1), MISSING_RETRY_MS),
      );
    } else if (load().delete(id)) {
      save();
    }

    return;
  }
  patch(id, { snoozed_until: undefined });
  telemetryCapture("session_triaged", { action: "woke" });
  const newest = [...appState.agents.values()]
    .filter((a) => a.sessionId === id)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  // Loaded on use: the notifier pulls in the agent service, and the warm policy imports this.
  import("../notifications/osNotification")
    .then(({ showAgentNotification }) =>
      showAgentNotification(
        {
          agent_id: newest?.agentId ?? null,
          session_id: id,
          tool_use_id: null,
          tool_name: null,
          kind: "push",
          title: `${path.basename(session.repo_root) || "Project"} session is back`,
          body: `${session.display_name ?? session.branch} was snoozed until now`,
        },
        { showLocal: true },
      ),
    )
    .catch((err: unknown) => {
      warn(`[triage] couldn't notify a woken session: ${String(err)}`);
    });
}

/** Arm every pending snooze and forget sessions as they're deleted. */
export function startSessionTriage(): void {
  for (const id of load().keys()) {
    arm(id);
  }
  removeSink ??= addHostEventSink((channel, args) => {
    if (channel !== "session:deleted" || typeof args[0] !== "string") {
      return;
    }
    const id = args[0];
    clearTimeout(timers.get(id));
    timers.delete(id);
    if (load().delete(id)) {
      save();
    }
  });
}

export function stopSessionTriage(): void {
  for (const timer of timers.values()) {
    clearTimeout(timer);
  }
  timers.clear();
  removeSink?.();
  removeSink = null;
  records = null;
}
