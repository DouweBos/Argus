/**
 * A session's version timeline: every agent turn with what it changed, and
 * every time the user put the files back to the end of one. Restoring leaves
 * the conversation alone (unlike a rewind) and can be undone from the safety
 * snapshot it takes first.
 */

import fs from "node:fs";
import path from "node:path";
import { warn } from "@argus/host/logger";
import { appState } from "../../state";
import { git } from "../session/git";
import { capture } from "../telemetry/telemetry";
import { isAgentBusy } from "./busy";
import {
  checkpointRef,
  resolveCheckpointRef,
  sessionWorktreePath,
  snapshotWorktree,
} from "./checkpoints";
import { type RecordedTurn, listRecordedTurns, turnEndSha } from "./turns";

const SAFETY_REF_PREFIX = "refs/argus/safety/";

export interface TimelineTurn {
  number: number;
  checkpointId: string;
  agentId: string;
  /** The agent's chat title; null before one is generated. */
  agentTitle: string | null;
  prompt: string;
  timestamp: number;
  /** False once the checkpoint ref is gone: nothing to diff or restore. */
  available: boolean;
  /** Still running, or no end was recorded and no turn followed. */
  finished: boolean;
  files: number;
  additions: number;
  deletions: number;
}

export interface TimelineRestore {
  id: string;
  checkpointId: string;
  turnNumber: number;
  timestamp: number;
  undoneAt: number | null;
  /** Only the latest restore, once, and before another turn starts. */
  canUndo: boolean;
}

export interface SessionTimeline {
  turns: TimelineTurn[];
  restores: TimelineRestore[];
  /** An agent in the session is mid-turn, so restoring is refused. */
  busy: boolean;
}

interface RestoreRecord {
  id: string;
  checkpointId: string;
  turnNumber: number;
  timestamp: number;
  /** The tree before the restore, pinned under `refs/argus/safety/<id>`. */
  safetySha: string;
  undoneAt: number | null;
}

/** Per worktree, in its git dir, so it goes when the worktree does. */
async function recordsPath(cwd: string): Promise<string> {
  return path.resolve(
    cwd,
    (await git(cwd, ["rev-parse", "--git-path", "argus-restores.json"])).trim(),
  );
}

async function loadRecords(cwd: string): Promise<RestoreRecord[]> {
  try {
    const parsed = JSON.parse(
      await fs.promises.readFile(await recordsPath(cwd), "utf8"),
    ) as { restores?: RestoreRecord[] };

    return parsed.restores ?? [];
  } catch {
    return [];
  }
}

async function saveRecords(
  cwd: string,
  records: RestoreRecord[],
): Promise<void> {
  const file = await recordsPath(cwd);
  await fs.promises.writeFile(
    `${file}.tmp`,
    JSON.stringify({ version: 1, restores: records }),
  );
  await fs.promises.rename(`${file}.tmp`, file);
}

function sessionBusy(sessionId: string): boolean {
  for (const agent of appState.agents.values()) {
    if (agent.sessionId === sessionId && isAgentBusy(agent)) {
      return true;
    }
  }

  return false;
}

function requireIdle(sessionId: string): void {
  if (sessionBusy(sessionId)) {
    throw "An agent in this session is still working. Stop it or wait for it to finish first.";
  }
}

/** Commits are immutable, so a range's stats never change. */
const statsCache = new Map<string, DiffStats>();
const STATS_CACHE_LIMIT = 2000;

interface DiffStats {
  files: number;
  additions: number;
  deletions: number;
}

async function diffStats(
  cwd: string,
  from: string,
  to: string,
): Promise<DiffStats> {
  const key = `${from}..${to}`;
  const hit = statsCache.get(key);
  if (hit) {
    return hit;
  }
  const out = await git(cwd, ["diff", "--numstat", "-z", from, to]);
  const stats = { files: 0, additions: 0, deletions: 0 };
  // -z: "add\tdel\tpath\0", a rename's two paths following an empty one.
  const fields = out.split("\0");
  for (let i = 0; i < fields.length; i++) {
    const match = /^(-|\d+)\t(-|\d+)\t(.*)$/.exec(fields[i]!);
    if (!match) {
      continue;
    }
    stats.files += 1;
    stats.additions += Number(match[1]) || 0;
    stats.deletions += Number(match[2]) || 0;
    if (match[3] === "") {
      i += 2;
    }
  }
  if (statsCache.size >= STATS_CACHE_LIMIT) {
    statsCache.clear();
  }
  statsCache.set(key, stats);

  return stats;
}

async function turnRow(
  cwd: string,
  turn: RecordedTurn,
  next: RecordedTurn | undefined,
  now: () => Promise<string>,
): Promise<TimelineTurn> {
  const { available: _, ...base } = turn;
  const empty = { files: 0, additions: 0, deletions: 0 };
  if (!turn.available) {
    return { ...base, available: false, finished: true, ...empty };
  }
  const from = await resolveCheckpointRef(
    cwd,
    checkpointRef(turn.checkpointId),
  );
  const end = await turnEndSha(cwd, turn, next);
  if (!from) {
    return { ...base, available: false, finished: true, ...empty };
  }

  return {
    ...base,
    available: true,
    finished: end !== null,
    ...(await diffStats(cwd, from, end ?? (await now()))),
  };
}

/** Turns oldest first with their stats, and the restores made between them. */
export async function getSessionTimeline(
  sessionId: string,
): Promise<SessionTimeline> {
  const cwd = sessionWorktreePath(sessionId);
  const turns = await listRecordedTurns(sessionId);
  const live = turns.filter((t) => t.available);
  let snapshot: Promise<string> | null = null;
  const now = () => (snapshot ??= snapshotWorktree(cwd).then((s) => s.sha));
  const rows = await Promise.all(
    turns.map((turn) => turnRow(cwd, turn, live[live.indexOf(turn) + 1], now)),
  );
  const records = await loadRecords(cwd);
  const undoable = undoableRestore(records, turns);

  return {
    turns: rows,
    restores: records.map((r) => ({
      id: r.id,
      checkpointId: r.checkpointId,
      turnNumber: r.turnNumber,
      timestamp: r.timestamp,
      undoneAt: r.undoneAt,
      canUndo: r === undoable,
    })),
    busy: sessionBusy(sessionId),
  };
}

/** The latest restore, until it's undone or a turn starts after it. */
function undoableRestore(
  records: RestoreRecord[],
  turns: RecordedTurn[],
): RestoreRecord | null {
  const last = records.at(-1);
  if (!last || last.undoneAt !== null) {
    return null;
  }

  return turns.some((t) => t.timestamp > last.timestamp) ? null : last;
}

/**
 * Put the tree back to `sha`'s, leaving HEAD and the conversation where they
 * are. The index ends at HEAD, so files the snapshot had untracked stay
 * untracked; files made since are removed, ignored ones kept.
 */
async function applyTree(cwd: string, sha: string): Promise<void> {
  await git(cwd, ["read-tree", "--reset", "-u", `${sha}^{tree}`]);
  await git(cwd, ["clean", "-fd"]);
  try {
    await git(cwd, ["reset", "-q"]);
  } catch {
    // Unborn branch: no HEAD to reset the index to.
    await git(cwd, ["read-tree", "--empty"]);
  }
}

/** Restore the files to where a turn ended, after pinning the tree as it is. */
export async function restoreToTurnEnd(
  sessionId: string,
  checkpointId: string,
): Promise<TimelineRestore> {
  const cwd = sessionWorktreePath(sessionId);
  requireIdle(sessionId);
  const live = (await listRecordedTurns(sessionId)).filter((t) => t.available);
  const index = live.findIndex((t) => t.checkpointId === checkpointId);
  const turn = live[index];
  if (!turn) {
    throw "That turn's checkpoint is gone";
  }
  const end = await turnEndSha(cwd, turn, live[index + 1]);
  if (!end) {
    throw "That turn hasn't finished yet";
  }
  const id = crypto.randomUUID();
  const safety = await snapshotWorktree(cwd);
  await git(cwd, ["update-ref", `${SAFETY_REF_PREFIX}${id}`, safety.sha]);
  await applyTree(cwd, end);
  const record: RestoreRecord = {
    id,
    checkpointId,
    turnNumber: turn.number,
    timestamp: Date.now(),
    safetySha: safety.sha,
    undoneAt: null,
  };
  const records = await loadRecords(cwd);
  try {
    await saveRecords(cwd, [...records, record]);
  } catch (e) {
    warn("timeline", "saving the restore failed", e);
  }
  capture("session_turn_restored", {
    turns_back: live.length - 1 - index,
  });

  return { ...record, canUndo: true };
}

/** Put the files back to how they were before the latest restore. */
export async function undoTurnRestore(
  sessionId: string,
  restoreId: string,
): Promise<void> {
  const cwd = sessionWorktreePath(sessionId);
  requireIdle(sessionId);
  const records = await loadRecords(cwd);
  const record = records.at(-1);
  if (!record || record.id !== restoreId) {
    throw "Only the latest restore can be undone";
  }
  if (record.undoneAt !== null) {
    throw "That restore was already undone";
  }
  if (!undoableRestore(records, await listRecordedTurns(sessionId))) {
    throw "An agent has worked since that restore, so undoing it would lose that work";
  }
  const ref = `${SAFETY_REF_PREFIX}${record.id}`;
  const sha = (await resolveCheckpointRef(cwd, ref)) ?? record.safetySha;
  // Edits made since the restore stay recoverable.
  const since = await snapshotWorktree(cwd);
  await git(cwd, ["update-ref", `${ref}-undo`, since.sha]);
  await applyTree(cwd, sha);
  record.undoneAt = Date.now();
  await saveRecords(cwd, records);
  capture("session_turn_restore_undone");
}
