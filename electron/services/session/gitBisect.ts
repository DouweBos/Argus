/**
 * Phase 7 T3 — git bisect (project-scope only).
 *
 * Each step IPC returns a `BisectStep` describing the new HEAD: subject + hash
 * if we're still narrowing, plus an optional `firstBadCommit` once the search
 * converges. Read-only `gitBisectStatus` reports active state for the
 * sidebar/banner.
 */

import { appState } from "../../state";
import { git } from "./git";
import { GitError } from "./gitError";
import { withGitLock } from "./gitLock";

function requireProjectScope(id: string): { path: string } {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw new GitError("unknown", `Session not found: ${id}`);
  }
  if (ws.kind !== "project_root") {
    throw new GitError(
      "unknown",
      "Bisect is only available on the project root",
    );
  }

  return { path: ws.path };
}

function requireSession(id: string): { path: string } {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw new GitError("unknown", `Session not found: ${id}`);
  }

  return { path: ws.path };
}

export interface BisectStep {
  currentRef: string | null;
  currentSubject: string | null;
  finished: boolean;
  firstBadCommit?: { hash: string; subject: string };
  remaining: number | null;
}

export interface BisectStatus extends BisectStep {
  active: boolean;
}

async function readHead(
  cwd: string,
): Promise<{ hash: string; subject: string }> {
  const hash = (await git(cwd, ["rev-parse", "HEAD"])).trim();
  const subject = (
    await git(cwd, ["log", "-1", "--format=%s", "HEAD"]).catch(() => "")
  ).trim();

  return { hash, subject };
}

function parseRemaining(out: string): number | null {
  // git bisect prints "Bisecting: N revisions left to test after this (~M steps)"
  const m = /Bisecting:\s+(\d+)\s+revisions left/i.exec(out);
  if (m) {
    return Number.parseInt(m[1] ?? "0", 10);
  }

  return null;
}

function parseFirstBad(out: string): { hash: string; subject: string } | null {
  // git bisect prints "<hash> is the first bad commit" followed by the commit
  // body. We only care about the hash and the first non-empty subject line
  // beneath the commit metadata.
  const headerMatch = /([0-9a-f]{40})\s+is the first bad commit/i.exec(out);
  if (!headerMatch) {
    return null;
  }
  const hash = headerMatch[1] ?? "";
  // The subject is "  <subject>" indented in `git show`; strip and pick the
  // first body-style line if present, else fall back to empty.
  const subjectMatch = /\n\s{4}([^\n]+)/.exec(out);

  return { hash, subject: subjectMatch?.[1]?.trim() ?? "" };
}

async function isBisectActive(cwd: string): Promise<boolean> {
  // .git/BISECT_LOG exists during a bisect.
  try {
    await git(cwd, ["rev-parse", "--git-dir"]);
  } catch {
    return false;
  }
  try {
    const gitDir = (await git(cwd, ["rev-parse", "--git-dir"])).trim();
    // If git-dir is relative, resolve against cwd.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const abs = path.isAbsolute(gitDir) ? gitDir : path.join(cwd, gitDir);
    await fs.access(path.join(abs, "BISECT_LOG"));

    return true;
  } catch {
    return false;
  }
}

async function buildStep(cwd: string, output: string): Promise<BisectStep> {
  const firstBad = parseFirstBad(output);
  if (firstBad) {
    return {
      finished: true,
      currentRef: null,
      currentSubject: null,
      remaining: 0,
      firstBadCommit: firstBad,
    };
  }
  const head = await readHead(cwd);

  return {
    finished: false,
    currentRef: head.hash,
    currentSubject: head.subject,
    remaining: parseRemaining(output),
  };
}

export async function gitBisectStart(
  id: string,
  opts: { badRef: string; goodRef: string },
): Promise<BisectStep> {
  const { path } = requireProjectScope(id);
  if (!opts.goodRef.trim() || !opts.badRef.trim()) {
    throw new GitError("unknown", "Both good and bad refs are required");
  }

  return withGitLock(path, async () => {
    await git(path, ["bisect", "start"]);
    await git(path, ["bisect", "bad", opts.badRef]);
    const out = await git(path, ["bisect", "good", opts.goodRef]);

    return buildStep(path, out);
  });
}

export async function gitBisectGood(id: string): Promise<BisectStep> {
  const { path } = requireProjectScope(id);

  return withGitLock(path, async () => {
    const out = await git(path, ["bisect", "good"]);

    return buildStep(path, out);
  });
}

export async function gitBisectBad(id: string): Promise<BisectStep> {
  const { path } = requireProjectScope(id);

  return withGitLock(path, async () => {
    const out = await git(path, ["bisect", "bad"]);

    return buildStep(path, out);
  });
}

export async function gitBisectSkip(id: string): Promise<BisectStep> {
  const { path } = requireProjectScope(id);

  return withGitLock(path, async () => {
    const out = await git(path, ["bisect", "skip"]);

    return buildStep(path, out);
  });
}

export async function gitBisectReset(id: string): Promise<void> {
  const { path } = requireProjectScope(id);
  await withGitLock(path, async () => {
    await git(path, ["bisect", "reset"]);
  });
}

/** Read-only status — both scopes accepted so the sidebar can poll cheaply. */
export async function gitBisectStatus(id: string): Promise<BisectStatus> {
  const { path } = requireSession(id);
  const active = await isBisectActive(path);
  if (!active) {
    return {
      active: false,
      finished: false,
      currentRef: null,
      currentSubject: null,
      remaining: null,
    };
  }
  const head = await readHead(path);

  return {
    active: true,
    finished: false,
    currentRef: head.hash,
    currentSubject: head.subject,
    remaining: null,
  };
}
