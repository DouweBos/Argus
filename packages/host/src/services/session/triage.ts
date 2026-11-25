/**
 * How a session sorts in the clients' lists: its workflow status (to do, in
 * progress, in review, done) with a note, snoozed until a time, and whether a
 * turn finished while nobody was looking.
 * `$ARGUS_HOME/session-triage.json`, keyed by session id. A snooze that runs
 * out clears itself and notifies, so the session comes back on its own.
 * Also when its last message went either way, so the lists sort by recency.
 */

import type { SessionWorkflowStatus } from "@argus/remote-protocol";
import fs from "node:fs";
import path from "node:path";
import { addHostEventSink, emitHostEvent } from "@argus/host/bus";
import { warn } from "@argus/host/logger";
import { argusHomeDir } from "../../lib/argusHome";
import { appState } from "../../state";
import { loadHistoryIndex } from "../agent/chatHistory";
import { readEnvelope, writeJson } from "../automation/jsonFile";
import { capture as telemetryCapture } from "../telemetry/telemetry";

/** 2 replaced v1's `settled` with `workflow_status`. */
const SCHEMA_VERSION = 2;
const NOTE_MAX = 140;
/** setTimeout's ceiling; a longer snooze re-arms when this one fires. */
const MAX_TIMER_MS = 2 ** 31 - 1;
const MISSING_RETRY_MS = 30_000;
const MISSING_RETRIES = 10;

export type TriageActor = "agent" | "user";

interface TriageRecord {
  id: string;
  /** Overrides the PR-derived default. */
  workflow_status?: SessionWorkflowStatus;
  status_note?: string;
  /** Epoch ms the session comes back. */
  snoozed_until?: number;
  unread?: boolean;
  /** Epoch ms of the latest user or agent message in it. */
  last_message_at?: number;
}

/** What a session listing carries. */
export interface SessionTriage {
  /** `workflow_status` as older clients read it: done or kept active. */
  settled: boolean | null;
  workflow_status: SessionWorkflowStatus | null;
  status_note: string | null;
  snoozed_until: number | null;
  unread: boolean;
  last_message_at: number | null;
}

let records: Map<string, TriageRecord> | null = null;
/** A stamp held back by the throttle, written at the next save. */
let dirty = false;
/** Per repo root: each session's newest saved chat, for sessions older than the stamp. */
const historyBackfill = new Map<string, Map<string, number>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let removeSink: (() => void) | null = null;

function filePath(): string {
  return path.join(argusHomeDir(), "session-triage.json");
}

type V1Record = Omit<TriageRecord, "workflow_status"> & { settled?: boolean };

/** v1 marked done or kept active; those are Done and In progress now. */
export function migrateV1(r: V1Record): TriageRecord {
  const { settled, ...rest } = r;
  if (settled === undefined) {
    return rest;
  }

  return { ...rest, workflow_status: settled ? "done" : "in_progress" };
}

function fileVersion(): unknown {
  try {
    return (
      JSON.parse(fs.readFileSync(filePath(), "utf8")) as { version?: unknown }
    ).version;
  } catch {
    return undefined;
  }
}

function load(): Map<string, TriageRecord> {
  if (records) {
    return records;
  }
  const v1 = fileVersion() === 1;
  const rows = readEnvelope<V1Record>(
    filePath(),
    "session triage",
    "sessions",
    v1 ? 1 : SCHEMA_VERSION,
  );
  records = new Map(rows.map((r) => [r.id, v1 ? migrateV1(r) : r]));
  if (v1) {
    save();
  }

  return records;
}

function save(): void {
  const all = [...load().values()].filter(
    (r) =>
      r.workflow_status !== undefined ||
      r.status_note !== undefined ||
      r.snoozed_until !== undefined ||
      r.unread ||
      r.last_message_at !== undefined,
  );
  dirty = false;
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

  const status = r?.workflow_status ?? null;

  return {
    settled: status === null ? null : status === "done",
    workflow_status: status,
    status_note: r?.status_note ?? null,
    snoozed_until: r?.snoozed_until ?? null,
    unread: r?.unread === true,
    last_message_at: r?.last_message_at ?? backfilledLastMessage(id),
  };
}

/** Its newest saved chat's end; one index read per project per host run. */
function backfilledLastMessage(id: string): number | null {
  const repoRoot = appState.sessions.get(id)?.repo_root;
  if (!repoRoot) {
    return null;
  }
  let byId = historyBackfill.get(repoRoot);
  if (!byId) {
    byId = new Map();
    for (const entry of loadHistoryIndex(repoRoot)) {
      const sid = entry.argusSessionId;
      if (sid && entry.endedAt > (byId.get(sid) ?? 0)) {
        byId.set(sid, entry.endedAt);
      }
    }
    historyBackfill.set(repoRoot, byId);
  }

  return byId.get(id) ?? null;
}

/** Stamp its latest message in memory; it's written by `publishLastMessage` or the next save. */
export function setLastMessageAt(id: string, at: number): void {
  const all = load();
  const record = all.get(id);
  if (!appState.sessions.has(id) || (record?.last_message_at ?? 0) >= at) {
    return;
  }
  all.set(id, { ...(record ?? { id }), last_message_at: at });
  dirty = true;
}

/** Write any held stamp and tell the clients. */
export function publishLastMessage(id: string): void {
  if (!appState.sessions.has(id)) {
    return;
  }
  if (dirty) {
    save();
  }
  emitHostEvent("session:updated", { id });
}

function requireSession(id: string): void {
  if (!appState.sessions.has(id)) {
    throw `Session not found: ${id}`;
  }
}

/** One line, trimmed and capped; empty clears it. */
export function normalizeStatusNote(note: string): string | undefined {
  const line = note.replace(/\s+/g, " ").trim();

  return line ? line.slice(0, NOTE_MAX) : undefined;
}

/**
 * Set its workflow status, or (null) go back to following the pull request.
 * `note` undefined keeps the note; null or blank clears it.
 */
export function setSessionStatus(
  id: string,
  status: SessionWorkflowStatus | null,
  note: string | null | undefined,
  actor: TriageActor,
): void {
  requireSession(id);
  const nextNote =
    note === undefined
      ? load().get(id)?.status_note
      : normalizeStatusNote(note ?? "");
  patch(id, {
    workflow_status: status ?? undefined,
    status_note: nextNote,
    // Done is a decision about it: nothing left to read.
    ...(status === "done" ? { unread: undefined } : {}),
  });
  telemetryCapture("session_triaged", {
    action: "status_set",
    status: status ?? "cleared",
    has_note: nextNote !== undefined,
    actor,
  });
}

/** Older clients' Mark as Done (true) / keep active (false) / follow the PR (null). */
export function setSessionSettled(id: string, settled: boolean | null): void {
  let status: SessionWorkflowStatus | null = null;
  if (settled !== null) {
    status = settled ? "done" : "in_progress";
  }
  setSessionStatus(id, status, undefined, "user");
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
      ? { action: "unsnoozed", actor: "user" }
      : {
          action: "snoozed",
          duration_bucket: durationBucket(until),
          actor: "user",
        },
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
  if (dirty) {
    save();
  }
  historyBackfill.clear();
  for (const timer of timers.values()) {
    clearTimeout(timer);
  }
  timers.clear();
  removeSink?.();
  removeSink = null;
  records = null;
}
