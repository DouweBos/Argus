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

import fs from "node:fs";
import path from "node:path";
import { emitHostEvent } from "../../bus";
import { info, warn } from "../../logger";
import { appState } from "../../state";
import {
  loadUserProjectSettings,
  saveUserProjectSettings,
} from "../userProjectSettings/store";
import { git, worktreesRoot } from "./git";
import { loadMetadata, normalizeMetaKey, saveMetadata } from "./metadata";
import { pathAvailability, volumeLabel } from "./volumeAvailability";
import { worktreeDirName } from "./worktreeLocation";
import { invalidateWorktreeLocationCache } from "./worktreeRootCache";

/** Files and directories Argus keeps beside the worktrees themselves. */
const SIDECARS = [".argus-chat-history", ".argus-command-metrics.json"];

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

export interface MoveWorktreesResult {
  failed: { error: string; id: string }[];
  moved: string[];
  to_root: string;
}

function sessionsFor(repoRoot: string) {
  return [...appState.sessions.values()].filter(
    (ws) => ws.repo_root === repoRoot && ws.kind === "worktree" && ws.path,
  );
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
): Promise<MoveWorktreesPlan> {
  const fromRoot = worktreesRoot(repoRoot);
  const toRoot = path.join(toBaseDir, worktreeDirName(repoRoot));
  const locked = await lockedPaths(repoRoot);
  const blockers: MoveBlocker[] = [];
  const sessions: MoveWorktreesPlan["sessions"] = [];

  for (const ws of sessionsFor(repoRoot)) {
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

/**
 * Move one worktree. Tries the atomic rename first, because when it works it
 * is exactly right; falls back to copy + repair across filesystems.
 */
async function moveOne(
  repoRoot: string,
  from: string,
  to: string,
): Promise<void> {
  try {
    await git(repoRoot, ["worktree", "move", from, to]);

    return;
  } catch (e) {
    info(`moveWorktrees: rename failed, copying instead: ${String(e)}`);
  }

  fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true });
  // Rewrites both the worktree's `.git` file and git's back-reference.
  await git(repoRoot, ["worktree", "repair", to]);
  // Only destroy the original once the copy is demonstrably a working tree.
  const top = (await git(to, ["rev-parse", "--show-toplevel"])).trim();
  if (!top) {
    throw `Copied worktree at ${to} is not usable; left the original in place.`;
  }
  fs.rmSync(from, { recursive: true, force: true });
}

function moveSidecars(fromRoot: string, toRoot: string): void {
  for (const name of SIDECARS) {
    const from = path.join(fromRoot, name);
    if (!fs.existsSync(from)) {
      continue;
    }
    try {
      fs.cpSync(from, path.join(toRoot, name), { recursive: true });
      fs.rmSync(from, { recursive: true, force: true });
    } catch (e) {
      warn(`moveWorktrees: could not move ${name}: ${String(e)}`);
    }
  }
}

export async function executeWorktreeMove(
  repoRoot: string,
  toBaseDir: string,
): Promise<MoveWorktreesResult> {
  const plan = await planWorktreeMove(repoRoot, toBaseDir);

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
    return { failed: [], moved: [], to_root: plan.to_root };
  }
  fs.mkdirSync(plan.to_root, { recursive: true });

  quiesce(plan.sessions.map((s) => s.id));

  const moved: string[] = [];
  const failed: MoveWorktreesResult["failed"] = [];
  const meta = loadMetadata(repoRoot);

  // Sequential: git serialises on the repo anyway, and a partial failure in
  // parallel is far harder to describe afterwards.
  for (const session of plan.sessions) {
    try {
      await moveOne(repoRoot, session.from, session.to);
      moved.push(session.id);

      const entry = meta.get(normalizeMetaKey(session.from));
      if (entry) {
        meta.delete(normalizeMetaKey(session.from));
        meta.set(normalizeMetaKey(session.to), entry);
      }
      const live = appState.sessions.get(session.id);
      if (live) {
        live.path = session.to;
      }
    } catch (e) {
      failed.push({ id: session.id, error: String(e) });
      warn(`moveWorktrees: ${session.from} failed: ${String(e)}`);
    }
  }

  if (moved.length > 0) {
    moveSidecars(plan.from_root, plan.to_root);
    saveMetadata(repoRoot, meta);
  }

  // Point the project at the new location. Anything that did not move stays
  // listed via `previous_worktrees_roots`, so a partial move is still a
  // complete sidebar.
  if (failed.length === 0 || moved.length > 0) {
    const previous = loadUserProjectSettings(repoRoot).previous_worktrees_roots;
    saveUserProjectSettings(repoRoot, {
      worktrees_base_dir: toBaseDir,
      previous_worktrees_roots:
        failed.length > 0
          ? [...new Set([...(previous ?? []), plan.from_root])]
          : previous,
    });
    invalidateWorktreeLocationCache(repoRoot);
  }

  emitHostEvent("session:worktrees-moved", {
    repoRoot,
    from_root: plan.from_root,
    to_root: plan.to_root,
    moved,
    failed,
  });

  return { failed, moved, to_root: plan.to_root };
}
