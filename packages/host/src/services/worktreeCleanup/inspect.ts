/**
 * Measure one worktree session for the cleanup: its size, when it was last
 * touched, and whether anything must keep it.
 */

import type { InspectedWorktree } from "./plan";
import type { Session } from "../session/models";
import type { WorktreeCleanupGuard } from "@argus/remote-protocol";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { appState } from "../../state";
import { isAgentBusy } from "../agent/busy";
import { loadHistoryIndex } from "../agent/chatHistory";
import { sessionPullRequestHeadSha } from "../github/sessionPullRequests";
import { git } from "../session/git";

const execFileAsync = promisify(execFile);
const DU_TIMEOUT_MS = 120_000;

/** Only plain worktrees: the repo root, scratch pads and automation hosts are never swept. */
export function isCleanupCandidate(session: Session): boolean {
  return (
    session.kind === "worktree" &&
    session.status === "ready" &&
    session.availability !== "unavailable" &&
    !session.setup_pending
  );
}

export async function worktreeBytes(dir: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("du", ["-sk", dir], {
      timeout: DU_TIMEOUT_MS,
    });
    const kb = Number.parseInt(stdout.trim().split(/\s/)[0] ?? "", 10);

    return Number.isFinite(kb) ? kb * 1024 : null;
  } catch {
    return null;
  }
}

async function lastCommitAt(dir: string): Promise<number> {
  try {
    const out = await git(dir, ["log", "-1", "--format=%ct", "HEAD"]);

    return Number.parseInt(out.trim(), 10) * 1000 || 0;
  } catch {
    return 0;
  }
}

function createdAt(dir: string): number {
  try {
    const stat = fs.statSync(dir);

    return stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs;
  } catch {
    return 0;
  }
}

/** Latest finished chat per Argus session, read once per project. */
export function chatActivityByRepo(repoRoot: string): Map<string, number> {
  const latest = new Map<string, number>();
  for (const entry of loadHistoryIndex(repoRoot)) {
    const id = entry.argusSessionId;
    if (id && entry.endedAt > (latest.get(id) ?? 0)) {
      latest.set(id, entry.endedAt);
    }
  }

  return latest;
}

function agentActivity(sessionId: string): {
  at: number;
  busy: boolean;
} {
  let at = 0;
  let busy = false;
  for (const agent of appState.agents.values()) {
    if (agent.sessionId !== sessionId) {
      continue;
    }
    at = Math.max(at, agent.lastEventAt, agent.createdAt);
    busy ||= isAgentBusy(agent);
  }

  return { at, busy };
}

async function isAncestor(dir: string, a: string, b: string) {
  try {
    await git(dir, ["merge-base", "--is-ancestor", a, b]);

    return true;
  } catch {
    return false;
  }
}

/**
 * Commits only this worktree has. Anything on a remote or on the local base
 * branch is kept elsewhere, and so is a merged PR's head GitHub still holds.
 */
async function hasUnpushedCommits(session: Session): Promise<boolean> {
  const dir = session.path;
  const exclude = ["--remotes"];
  if (
    session.base_branch &&
    (await git(dir, [
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/heads/${session.base_branch}`,
    ]).then(
      () => true,
      () => false,
    ))
  ) {
    exclude.push(`refs/heads/${session.base_branch}`);
  }
  const count = await git(dir, [
    "rev-list",
    "--count",
    "HEAD",
    "--not",
    ...exclude,
  ]);
  if (Number.parseInt(count.trim(), 10) === 0) {
    return false;
  }
  const prHead = sessionPullRequestHeadSha(session.id);

  return !(
    prHead &&
    (session.pull_request?.state === "merged" ||
      session.pull_request?.state === "closed") &&
    (await isAncestor(dir, "HEAD", prHead))
  );
}

async function guardFor(
  session: Session,
  agentBusy: boolean,
): Promise<WorktreeCleanupGuard | null> {
  if (agentBusy) {
    return "agent_running";
  }
  try {
    const status = await git(session.path, ["status", "--porcelain"]);
    if (status.trim() !== "") {
      return "uncommitted";
    }

    return (await hasUnpushedCommits(session)) ? "unpushed" : null;
  } catch {
    return "unreadable";
  }
}

export async function inspectWorktree(
  session: Session,
  landedAt: number | null,
  chatActivity: Map<string, number>,
): Promise<InspectedWorktree> {
  const agents = agentActivity(session.id);
  const [bytes, commitAt, blocked] = await Promise.all([
    worktreeBytes(session.path),
    lastCommitAt(session.path),
    guardFor(session, agents.busy),
  ]);

  return {
    session_id: session.id,
    repo_root: session.repo_root,
    project_name: path.basename(session.repo_root),
    branch: session.branch,
    display_name: session.display_name ?? null,
    bytes,
    last_activity_at: Math.max(
      commitAt,
      createdAt(session.path),
      agents.at,
      chatActivity.get(session.id) ?? 0,
    ),
    landed_at: landedAt,
    blocked_by: blocked,
  };
}
