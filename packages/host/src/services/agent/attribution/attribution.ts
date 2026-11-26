/**
 * Line attribution: which lines of a session's changed files an agent wrote and
 * which a person edited since. Agent edit tool calls mark the lines they wrote;
 * a save from the editor, or any change between turns, turns what it touched
 * to human. Kept under ARGUS_HOME per session, never in the worktree.
 */

import type { LlmStreamEvent } from "../conversation/types";
import fs from "node:fs";
import path from "node:path";
import { addHostEventSink } from "@argus/host/bus";
import { warn } from "@argus/host/logger";
import { argusHomeDir } from "../../../lib/argusHome";
import { appState } from "../../../state";
import { onCodeFileWritten } from "../../code/files";
import { git } from "../../session/git";
import { isAgentBusy } from "../busy";
import {
  type AttributedRange,
  type FileLines,
  type LineAuthor,
  fromRanges,
  project,
  reconcile,
  splitLines,
  toRanges,
  unattributed,
} from "./lines";
import { type AgentEdit, agentEdits, normalizeLine } from "./toolCalls";

export interface FileLineAttribution {
  path: string;
  ranges: AttributedRange[];
}

export interface LineAttribution {
  /** Files with at least one marked line, by path. */
  files: FileLineAttribution[];
}

interface SessionState {
  /** The tree an untracked file is compared from: the latest turn's checkpoint, else HEAD. */
  baseline: string | null;
  files: Map<string, FileLines>;
}

interface SavedFile {
  hashes: string[];
  ranges: AttributedRange[];
}

interface SavedState {
  baseline: string | null;
  files: Record<string, SavedFile>;
  version: 1;
}

const MAX_BYTES = 2 * 1024 * 1024;

const sessions = new Map<string, SessionState>();
const chains = new Map<string, Promise<unknown>>();
/** Edit calls waiting on their result: tool_use id → session and edits. */
const pending = new Map<string, { edits: AgentEdit[]; sessionId: string }>();

function storeDir(): string {
  return path.join(argusHomeDir(), "line-attribution");
}

function storePath(sessionId: string): string {
  return path.join(storeDir(), `${encodeURIComponent(sessionId)}.json`);
}

function worktreeOf(sessionId: string): string | null {
  const session = appState.sessions.get(sessionId);
  if (
    !session ||
    (session.kind !== "worktree" && session.kind !== "project_root")
  ) {
    return null;
  }

  return session.path;
}

function load(sessionId: string): SessionState {
  const cached = sessions.get(sessionId);
  if (cached) {
    return cached;
  }
  const state: SessionState = { baseline: null, files: new Map() };
  try {
    const saved = JSON.parse(
      fs.readFileSync(storePath(sessionId), "utf8"),
    ) as SavedState;
    state.baseline = saved.baseline ?? null;
    for (const [file, entry] of Object.entries(saved.files ?? {})) {
      state.files.set(file, {
        hashes: entry.hashes,
        authors: fromRanges(entry.ranges, entry.hashes.length),
      });
    }
  } catch {
    // Nothing recorded yet.
  }
  sessions.set(sessionId, state);

  return state;
}

async function save(sessionId: string, state: SessionState): Promise<void> {
  const files: Record<string, SavedFile> = {};
  for (const [file, lines] of state.files) {
    files[file] = { hashes: lines.hashes, ranges: toRanges(lines.authors) };
  }
  const saved: SavedState = { version: 1, baseline: state.baseline, files };
  const target = storePath(sessionId);
  await fs.promises.mkdir(storeDir(), { recursive: true });
  await fs.promises.writeFile(`${target}.tmp`, JSON.stringify(saved));
  await fs.promises.rename(`${target}.tmp`, target);
}

/** One job per session at a time, in the order the events came. */
function enqueue<T>(sessionId: string, job: () => Promise<T>): Promise<T> {
  const previous = chains.get(sessionId) ?? Promise.resolve();
  const next = previous.then(job, job);
  const settled = next.catch((e: unknown) => {
    warn("attribution", "updating line attribution failed", e);
  });
  chains.set(sessionId, settled);
  settled.then(() => {
    if (chains.get(sessionId) === settled) {
      chains.delete(sessionId);
    }
  });

  return next;
}

/** The file's lines, or null when it's gone, binary or too big to follow. */
async function readLines(absolute: string): Promise<string[] | null> {
  try {
    const stat = await fs.promises.stat(absolute);
    if (!stat.isFile() || stat.size > MAX_BYTES) {
      return null;
    }
    const bytes = await fs.promises.readFile(absolute);
    if (bytes.subarray(0, 8192).includes(0)) {
      return null;
    }

    return splitLines(bytes.toString("utf8"));
  } catch {
    return null;
  }
}

async function baselineLines(
  cwd: string,
  state: SessionState,
  file: string,
): Promise<string[]> {
  try {
    return splitLines(
      await git(cwd, ["show", `${state.baseline ?? "HEAD"}:${file}`]),
    );
  } catch {
    // New since the baseline, or an unborn branch.
    return [];
  }
}

function sameLines(a: FileLines, b: FileLines): boolean {
  return (
    a.hashes.length === b.hashes.length &&
    a.hashes.every((h, i) => h === b.hashes[i]) &&
    a.authors.every((x, i) => x === b.authors[i])
  );
}

/** Bring one file up to date; true when what's recorded changed. */
async function reconcileFile(
  cwd: string,
  state: SessionState,
  file: string,
  decide: (line: string) => LineAuthor | null,
): Promise<boolean> {
  const lines = await readLines(path.join(cwd, file));
  if (!lines) {
    return state.files.delete(file);
  }
  const prev =
    state.files.get(file) ??
    unattributed(await baselineLines(cwd, state, file));
  const next = reconcile(prev, lines, decide);
  if (state.files.has(file) && sameLines(prev, next)) {
    return false;
  }
  state.files.set(file, next);

  return true;
}

async function reconcileAll(
  sessionId: string,
  decide: (line: string) => LineAuthor | null,
): Promise<void> {
  const cwd = worktreeOf(sessionId);
  if (!cwd) {
    return;
  }
  const state = load(sessionId);
  let changed = false;
  for (const file of [...state.files.keys()]) {
    changed = (await reconcileFile(cwd, state, file, decide)) || changed;
  }
  if (changed) {
    await save(sessionId, state);
  }
}

const human = (): LineAuthor => "human";
const unknown = (): null => null;

/** A path the tool wrote, relative to the worktree; null outside it. */
export function worktreeRelative(cwd: string, filePath: string): string | null {
  const absolute = path.isAbsolute(filePath)
    ? filePath
    : path.join(cwd, filePath);
  const relative = path.relative(cwd, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return relative.split(path.sep).join("/");
}

/** Lines the call wrote turn agent; other changes since the last look stay unmarked. */
export function agentDecider(
  edit: AgentEdit,
): (line: string) => LineAuthor | null {
  const { lines } = edit;

  return (line) =>
    lines === null || lines.has(normalizeLine(line)) ? "agent" : null;
}

async function applyAgentEdits(
  sessionId: string,
  edits: AgentEdit[],
): Promise<void> {
  const cwd = worktreeOf(sessionId);
  if (!cwd) {
    return;
  }
  const state = load(sessionId);
  let changed = false;
  for (const edit of edits) {
    const file = worktreeRelative(cwd, edit.filePath);
    if (file) {
      changed =
        (await reconcileFile(cwd, state, file, agentDecider(edit))) || changed;
    }
  }
  if (changed) {
    await save(sessionId, state);
  }
}

/** Watches the stream for edit tool calls and records each once its result lands. */
export function observeAttributionEvent(
  sessionId: string | null | undefined,
  event: LlmStreamEvent,
): void {
  if (!sessionId) {
    return;
  }
  if (event.type === "assistant") {
    for (const block of event.message.content ?? []) {
      if (block.type !== "tool_use") {
        continue;
      }
      const edits = agentEdits(block.name, block.input);
      if (edits.length > 0) {
        pending.set(block.id, { sessionId, edits });
      }
    }

    return;
  }
  if (event.type !== "user" || pending.size === 0) {
    return;
  }
  for (const block of event.message.content ?? []) {
    if (block.type !== "tool_result") {
      continue;
    }
    // A runner that splits one patch into several cards answers them all at once.
    for (const [id, call] of pending) {
      if (id !== block.tool_use_id && !id.startsWith(`${block.tool_use_id}:`)) {
        continue;
      }
      pending.delete(id);
      if (block.is_error !== true) {
        enqueue(call.sessionId, () =>
          applyAgentEdits(call.sessionId, call.edits),
        ).catch(() => undefined);
      }
    }
  }
}

/** A prompt went out: what changed since the last turn was a person's doing. */
export function noteTurnStarted(
  sessionId: string | null | undefined,
  checkpointId?: string,
): void {
  if (!sessionId) {
    return;
  }
  enqueue(sessionId, async () => {
    await reconcileAll(sessionId, human);
    const cwd = worktreeOf(sessionId);
    if (!cwd || !checkpointId) {
      return;
    }
    const state = load(sessionId);
    try {
      state.baseline = (
        await git(cwd, [
          "rev-parse",
          "--verify",
          `refs/argus/checkpoints/${checkpointId}^{commit}`,
        ])
      ).trim();
      await save(sessionId, state);
    } catch {
      // No checkpoint: HEAD stands in.
    }
  }).catch(() => undefined);
}

/**
 * The turn is over. Changes it made without an edit tool (a script, a
 * formatter) are nobody's we can name, so they carry no mark.
 */
export function noteTurnEnded(sessionId: string | null | undefined): void {
  if (sessionId) {
    enqueue(sessionId, () => reconcileAll(sessionId, unknown)).catch(
      () => undefined,
    );
  }
}

/** Files put back to a checkpoint or a turn's end: neither side wrote them just now. */
export function noteFilesRestored(sessionId: string): Promise<void> {
  return enqueue(sessionId, () => reconcileAll(sessionId, unknown)).catch(
    () => undefined,
  );
}

/** A save from the editor: what it changed is the person's. */
export function noteHumanWrite(
  sessionId: string,
  absolute: string,
): Promise<void> {
  return enqueue(sessionId, async () => {
    const cwd = worktreeOf(sessionId);
    const file = cwd ? worktreeRelative(cwd, absolute) : null;
    if (!cwd || !file) {
      return;
    }
    const state = load(sessionId);
    if (await reconcileFile(cwd, state, file, human)) {
      await save(sessionId, state);
    }
  });
}

function sessionBusy(sessionId: string): boolean {
  for (const agent of appState.agents.values()) {
    if (agent.sessionId === sessionId && isAgentBusy(agent)) {
      return true;
    }
  }

  return false;
}

/**
 * Marked lines of every followed file as the worktree has them now. Between
 * turns, changes since the last look are settled as human first; mid-turn
 * they show unmarked until the agent's call lands.
 */
export function getLineAttribution(
  sessionId: string,
): Promise<LineAttribution> {
  return enqueue(sessionId, async () => {
    const cwd = worktreeOf(sessionId);
    if (!cwd) {
      return { files: [] };
    }
    if (!sessionBusy(sessionId)) {
      await reconcileAll(sessionId, human);
    }
    const state = load(sessionId);
    const files: FileLineAttribution[] = [];
    for (const [file, recorded] of state.files) {
      const lines = await readLines(path.join(cwd, file));
      if (!lines) {
        continue;
      }
      const ranges = toRanges(project(recorded, lines).authors);
      if (ranges.length > 0) {
        files.push({ path: file, ranges });
      }
    }
    files.sort((a, b) => a.path.localeCompare(b.path));

    return { files };
  });
}

function forget(sessionId: string): void {
  sessions.delete(sessionId);
  fs.promises.rm(storePath(sessionId), { force: true }).catch(() => undefined);
}

let stop: (() => void) | null = null;

export function startLineAttribution(): void {
  if (stop) {
    return;
  }
  const stopWrites = onCodeFileWritten((sessionId, absolute) => {
    noteHumanWrite(sessionId, absolute).catch(() => undefined);
  });
  const stopEvents = addHostEventSink((channel, args) => {
    if (channel === "session:deleted" && typeof args[0] === "string") {
      forget(args[0]);
    }
  });
  stop = () => {
    stopWrites();
    stopEvents();
  };
}

/** Tests only. */
export function resetLineAttribution(): void {
  stop?.();
  stop = null;
  sessions.clear();
  chains.clear();
  pending.clear();
}

/** Tests only: resolves once every queued job has run. */
export async function settledLineAttribution(): Promise<void> {
  while (chains.size > 0) {
    await Promise.all([...chains.values()]);
  }
}
