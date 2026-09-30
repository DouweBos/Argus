/**
 * Relocating a project's worktrees after its location setting changes.
 *
 * `git worktree move` renames, so it fails across filesystems — and the whole
 * point of this feature is moving to a different drive, which is always
 * cross-device. The fallback is copy → `git worktree repair` → verify →
 * delete the source, which is what actually runs in practice. The original is
 * only removed once the copy is confirmed working, so an interrupted move
 * leaves the worktree where it was rather than nowhere.
 */

import type { WorktreePurpose } from "./worktreeLocationCore";
import fs from "node:fs";
import path from "node:path";
import { emitHostEvent } from "../../bus";
import { info, warn } from "../../logger";
import { appState } from "../../state";
import { liveOwnedSessions } from "../automation/ownedSessions";
import { capture as telemetryCapture } from "../telemetry/telemetry";
import {
  loadUserProjectSettings,
  saveUserProjectSettings,
} from "../userProjectSettings/store";
import { git, worktreesRoot } from "./git";
import { loadMetadata, normalizeMetaKey, saveMetadata } from "./metadata";
import {
  mountRootFor,
  pathAvailability,
  volumeLabel,
} from "./volumeAvailability";
import { isInsideRoot, worktreeDirName } from "./worktreeLocation";
import { invalidateWorktreeLocationCache } from "./worktreeRootCache";

export type MoveBlockerKind =
  | "agent_running"
  | "locked"
  | "mid_operation"
  | "terminal_open";

export interface MoveBlocker {
  detail: string;
  kind: MoveBlockerKind;
  session_id: string;
  session_label: string;
}

export interface MoveWorktreesPlan {
  blockers: MoveBlocker[];
  from_root: string;
  sessions: { branch: string; from: string; id: string; to: string }[];
  to_root: string;
}

export type MoveStep = "copying" | "counting" | "moving" | "removing";

/** Emitted on `session:worktrees-move-progress` while a move runs. */
export interface MoveWorktreesProgress {
  branch: string;
  /** Entries copied so far in the current worktree; 0 outside `copying`. */
  done_entries: number;
  /** 0-based position of the worktree being moved. */
  index: number;
  repo_root: string;
  session_id: string;
  step: MoveStep;
  total: number;
  /** Entries in the current worktree; 0 while unknown. */
  total_entries: number;
}

/** Progress events are throttled so a big `node_modules` isn't a firehose. */
const PROGRESS_INTERVAL_MS = 200;

export interface MoveWorktreesResult {
  failed: { error: string; id: string }[];
  moved: string[];
  to_root: string;
}

/**
 * The worktrees a move of `purpose` should relocate.
 *
 * Containment in the from-root is the durable signal. It stops being enough in
 * one case: setting an automation base for the first time, where the automation
 * root *is* the user root and every session in the project would match. There,
 * fall back to the automation's own ownership claims — a claim that has expired
 * just leaves that worktree where it is, which is safe.
 */
function sessionsFor(repoRoot: string, purpose: WorktreePurpose) {
  const fromRoot = worktreesRoot(repoRoot, purpose);
  const inRoot = [...appState.sessions.values()].filter(
    (ws) =>
      ws.repo_root === repoRoot &&
      ws.kind === "worktree" &&
      ws.path &&
      isInsideRoot(fromRoot, ws.path),
  );

  if (
    purpose !== "automation" ||
    fromRoot !== worktreesRoot(repoRoot, "user")
  ) {
    return inRoot;
  }

  const owned = new Set(liveOwnedSessions().map((claim) => claim.session_id));

  return inRoot.filter((ws) => owned.has(ws.id));
}

/**
 * A linked worktree's `.git` is a *file* pointing at the real gitdir under
 * the repo, so the in-progress markers are not where they are in a normal
 * checkout.
 */
function gitDirOf(worktreePath: string): string {
  const dotGit = path.join(worktreePath, ".git");
  try {
    if (fs.statSync(dotGit).isDirectory()) {
      return dotGit;
    }
    const pointer = fs.readFileSync(dotGit, "utf8").trim();
    const target = pointer.startsWith("gitdir: ")
      ? pointer.slice("gitdir: ".length).trim()
      : "";

    return path.isAbsolute(target) ? target : path.join(worktreePath, target);
  } catch {
    return dotGit;
  }
}

/** A worktree mid-rebase or mid-merge must not be moved out from under git. */
function midOperation(worktreePath: string): boolean {
  const gitDir = gitDirOf(worktreePath);

  return [
    "rebase-merge",
    "rebase-apply",
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
  ].some((marker) => fs.existsSync(path.join(gitDir, marker)));
}

async function lockedPaths(repoRoot: string): Promise<Set<string>> {
  const locked = new Set<string>();
  let raw: string;
  try {
    raw = await git(repoRoot, ["worktree", "list", "--porcelain"]);
  } catch {
    return locked;
  }
  let current: string | null = null;
  for (const line of raw.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = line.slice("worktree ".length).trim();
    } else if (line.startsWith("locked") && current) {
      locked.add(current);
    }
  }

  return locked;
}

export async function planWorktreeMove(
  repoRoot: string,
  toBaseDir: string,
  purpose: WorktreePurpose = "user",
): Promise<MoveWorktreesPlan> {
  const fromRoot = worktreesRoot(repoRoot, purpose);
  const toRoot = path.join(toBaseDir, worktreeDirName(repoRoot));
  const locked = await lockedPaths(repoRoot);
  const blockers: MoveBlocker[] = [];
  const sessions: MoveWorktreesPlan["sessions"] = [];

  for (const ws of sessionsFor(repoRoot, purpose)) {
    const label = ws.display_name ?? ws.branch;
    if (locked.has(ws.path)) {
      blockers.push({
        kind: "locked",
        session_id: ws.id,
        session_label: label,
        detail: "the worktree is locked in git",
      });
      continue;
    }
    if (midOperation(ws.path)) {
      blockers.push({
        kind: "mid_operation",
        session_id: ws.id,
        session_label: label,
        detail: "a rebase or merge is in progress",
      });
      continue;
    }
    for (const agent of appState.agents.values()) {
      if (agent.sessionId === ws.id) {
        blockers.push({
          kind: "agent_running",
          session_id: ws.id,
          session_label: label,
          detail: "an agent is running",
        });
        break;
      }
    }
    for (const key of appState.terminals.keys()) {
      if (key.includes(ws.id)) {
        blockers.push({
          kind: "terminal_open",
          session_id: ws.id,
          session_label: label,
          detail: "a terminal is open",
        });
        break;
      }
    }
    sessions.push({
      id: ws.id,
      branch: ws.branch,
      from: ws.path,
      to: path.join(toRoot, path.basename(ws.path)),
    });
  }

  return { blockers, from_root: fromRoot, sessions, to_root: toRoot };
}

/** Stop everything holding a file descriptor in these worktrees. */
function quiesce(sessionIds: string[]): void {
  for (const [key, agent] of appState.agents.entries()) {
    if (sessionIds.includes(agent.sessionId)) {
      agent.handle.kill().catch((e: unknown) => {
        info(`moveWorktrees: kill agent ${key} returned:`, e);
      });
      appState.agents.delete(key);
    }
  }
  for (const id of sessionIds) {
    for (const key of [...appState.terminals.keys()]) {
      if (key.includes(id)) {
        try {
          appState.terminals.get(key)?.pty.kill();
        } catch {
          // Already gone.
        }
        appState.terminals.delete(key);
      }
    }
  }
}

type StepReporter = (step: MoveStep, done?: number, total?: number) => void;

async function countEntries(dir: string): Promise<number> {
  try {
    return (await fs.promises.readdir(dir, { recursive: true })).length;
  } catch {
    return 0;
  }
}

/**
 * Point every submodule in a copied worktree back at its git dir. Git writes
 * those links relative to where the worktree was created, so a copy breaks
 * them, and `git worktree repair` leaves submodules alone.
 */
async function repairSubmodules(worktree: string): Promise<void> {
  const gitDir = (
    await git(worktree, ["rev-parse", "--absolute-git-dir"])
  ).trim();
  let listed: string;
  try {
    listed = await git(worktree, [
      "config",
      "--file",
      ".gitmodules",
      "--get-regexp",
      "^submodule\\..*\\.path$",
    ]);
  } catch {
    return;
  }
  for (const line of listed.split("\n").filter(Boolean)) {
    const space = line.indexOf(" ");
    const name = line.slice("submodule.".length, space - ".path".length);
    const moduleDir = path.join(gitDir, "modules", name);
    const checkout = path.join(worktree, line.slice(space + 1));
    const link = path.join(checkout, ".git");
    if (
      !fs.existsSync(moduleDir) ||
      !fs.statSync(link, { throwIfNoEntry: false })?.isFile()
    ) {
      continue;
    }
    await fs.promises.writeFile(link, `gitdir: ${moduleDir}\n`, "utf8");
    await git(worktree, [
      "config",
      "--file",
      path.join(moduleDir, "config"),
      "core.worktree",
      checkout,
    ]);
    await repairSubmodules(checkout);
  }
}

/**
 * Move one worktree. Tries the atomic rename first, because when it works it
 * is exactly right; falls back to copy + repair across filesystems. Async
 * throughout — a sync copy of a multi-GB tree freezes the whole host.
 */
async function moveOne(
  repoRoot: string,
  from: string,
  to: string,
  report: StepReporter,
): Promise<"copied" | "renamed"> {
  report("moving");
  try {
    await git(repoRoot, ["worktree", "move", from, to]);

    return "renamed";
  } catch (e) {
    info(`moveWorktrees: rename failed, copying instead: ${String(e)}`);
  }

  report("counting");
  const total = await countEntries(from);
  let done = 0;
  report("copying", 0, total);
  await fs.promises.cp(from, to, {
    recursive: true,
    verbatimSymlinks: true,
    filter: () => {
      done += 1;
      report("copying", done, total);

      return true;
    },
  });
  // Rewrites both the worktree's `.git` file and git's back-reference.
  await git(repoRoot, ["worktree", "repair", to]);
  await repairSubmodules(to);
  // Only destroy the original once the copy is demonstrably a working tree.
  const top = (await git(to, ["rev-parse", "--show-toplevel"])).trim();
  if (!top) {
    throw `Copied worktree at ${to} is not usable; left the original in place.`;
  }
  report("removing");
  await fs.promises.rm(from, { recursive: true, force: true });

  return "copied";
}

function durationBucket(ms: number): "<1m" | "<10m" | "<10s" | ">=10m" {
  if (ms < 10_000) {
    return "<10s";
  }
  if (ms < 60_000) {
    return "<1m";
  }

  return ms < 600_000 ? "<10m" : ">=10m";
}

export async function executeWorktreeMove(
  repoRoot: string,
  toBaseDir: string,
  purpose: WorktreePurpose = "user",
): Promise<MoveWorktreesResult> {
  const plan = await planWorktreeMove(repoRoot, toBaseDir, purpose);
  const baseKey =
    purpose === "automation"
      ? "automation_worktrees_base_dir"
      : "worktrees_base_dir";

  if (pathAvailability(toBaseDir).state === "volume_missing") {
    throw `${volumeLabel(toBaseDir)} isn't connected.`;
  }
  if (!fs.existsSync(toBaseDir)) {
    fs.mkdirSync(toBaseDir, { recursive: true });
  }
  try {
    fs.accessSync(toBaseDir, fs.constants.W_OK);
  } catch {
    throw `Argus can't write to ${toBaseDir}.`;
  }
  if (plan.to_root === plan.from_root) {
    // Nothing to relocate, but the setting still has to land — otherwise
    // pointing automations at the current location silently does nothing.
    saveUserProjectSettings(repoRoot, { [baseKey]: toBaseDir });
    invalidateWorktreeLocationCache(repoRoot);

    return { failed: [], moved: [], to_root: plan.to_root };
  }
  fs.mkdirSync(plan.to_root, { recursive: true });

  quiesce(plan.sessions.map((s) => s.id));

  const moved: string[] = [];
  const failed: MoveWorktreesResult["failed"] = [];
  const meta = loadMetadata(repoRoot);
  const startedAt = Date.now();
  let copied = false;

  // Sequential: git serialises on the repo anyway, and a partial failure in
  // parallel is far harder to describe afterwards.
  for (const [index, session] of plan.sessions.entries()) {
    let lastStep: MoveStep | null = null;
    let lastEmit = 0;
    const report: StepReporter = (step, done = 0, total = 0) => {
      const now = Date.now();
      if (step === lastStep && now - lastEmit < PROGRESS_INTERVAL_MS) {
        return;
      }
      lastStep = step;
      lastEmit = now;
      const progress: MoveWorktreesProgress = {
        branch: session.branch,
        done_entries: done,
        index,
        repo_root: repoRoot,
        session_id: session.id,
        step,
        total: plan.sessions.length,
        total_entries: total,
      };
      emitHostEvent("session:worktrees-move-progress", progress);
    };
    try {
      if (
        (await moveOne(repoRoot, session.from, session.to, report)) === "copied"
      ) {
        copied = true;
      }
      moved.push(session.id);

      const entry = meta.get(normalizeMetaKey(session.from));
      if (entry) {
        meta.delete(normalizeMetaKey(session.from));
        meta.set(normalizeMetaKey(session.to), entry);
      }
      const volume = mountRootFor(session.to, process.platform);
      const live = appState.sessions.get(session.id);
      if (live) {
        live.path = session.to;
        live.volume = volume;
      }
      emitHostEvent("session:updated", {
        id: session.id,
        path: session.to,
        volume,
      });
    } catch (e) {
      failed.push({ id: session.id, error: String(e) });
      warn(`moveWorktrees: ${session.from} failed: ${String(e)}`);
    }
  }

  if (moved.length > 0) {
    saveMetadata(repoRoot, meta);
  }

  // Point the project at the new location. Anything that did not move stays
  // listed via `previous_worktrees_roots`, so a partial move is still a
  // complete sidebar.
  if (failed.length === 0 || moved.length > 0) {
    const previous = loadUserProjectSettings(repoRoot).previous_worktrees_roots;
    saveUserProjectSettings(repoRoot, {
      [baseKey]: toBaseDir,
      previous_worktrees_roots:
        failed.length > 0
          ? [...new Set([...(previous ?? []), plan.from_root])]
          : previous,
    });
    invalidateWorktreeLocationCache(repoRoot);
  }

  telemetryCapture("worktrees_moved", {
    copied,
    duration_bucket: durationBucket(Date.now() - startedAt),
    failed: failed.length,
    moved: moved.length,
    purpose,
  });

  emitHostEvent("session:worktrees-moved", {
    repoRoot,
    from_root: plan.from_root,
    to_root: plan.to_root,
    moved,
    failed,
  });

  return { failed, moved, to_root: plan.to_root };
}
