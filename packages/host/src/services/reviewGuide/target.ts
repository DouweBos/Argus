/**
 * What a review guide reads: the diff, the head it's keyed by, and a checkout
 * the agent may look around in — the session's worktree, or for a pull
 * request a detached worktree of its head under `$ARGUS_HOME/review-guides`.
 */

import type { RepoRef } from "../codeHost/remoteUrl";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { argusHomeDir } from "../../lib/argusHome";
import { appState } from "../../state";
import { codeHost } from "../codeHost/hosts";
import { remoteRepoRefs } from "../codeHost/repos";
import { git } from "../session/git";

const execFileAsync = promisify(execFile);

export type GuideTarget =
  | { kind: "pull_request"; repo: string; number: number }
  | { kind: "session"; sessionId: string };

export interface ResolvedTarget {
  headSha: string;
  baseRef: string;
  patch: string;
  /** Where the agent reads the code. */
  cwd: string;
  subject: string;
  description?: string;
}

export function targetKey(target: GuideTarget): string {
  return target.kind === "session"
    ? `session:${target.sessionId}`
    : `pr:${target.repo}#${target.number}`;
}

export function guidesDir(): string {
  return path.join(argusHomeDir(), "review-guides");
}

function hash(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

async function revParse(cwd: string, ref: string): Promise<string | null> {
  return (
    (
      await git(cwd, [
        "rev-parse",
        "--verify",
        "--quiet",
        `${ref}^{commit}`,
      ]).catch(() => "")
    ).trim() || null
  );
}

/** The session's base as git can name it: the local branch, else its remote twin. */
async function sessionBase(cwd: string, base: string): Promise<string> {
  if (await revParse(cwd, base)) {
    return base;
  }
  if (await revParse(cwd, `origin/${base}`)) {
    return `origin/${base}`;
  }
  throw `Can't find the base branch ${base}.`;
}

/** Untracked files as additions, as the Changes view shows them. */
async function untrackedPatch(cwd: string): Promise<string> {
  const listed = await git(cwd, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ]);
  const paths = listed.split("\0").filter(Boolean).slice(0, 200);
  let out = "";
  for (const file of paths) {
    // `--no-index` exits 1 when the files differ, which is always.
    const diff = await execFileAsync(
      "git",
      ["diff", "--no-index", "--", "/dev/null", file],
      {
        cwd,
        maxBuffer: 10 * 1024 * 1024,
      },
    ).catch((e: { stdout?: string }) => ({ stdout: e.stdout ?? "" }));
    out += diff.stdout;
  }

  return out;
}

/** The session's head, plus a hash of its uncommitted work, which the guide is keyed by too. */
export async function sessionHead(sessionId: string): Promise<string> {
  const session = appState.sessions.get(sessionId);
  if (!session) {
    throw `Session not found: ${sessionId}`;
  }
  const head = (await git(session.path, ["rev-parse", "HEAD"])).trim();
  const status = await git(session.path, ["status", "--porcelain=v1", "-z"]);
  if (!status) {
    return head;
  }
  const dirty = (await git(session.path, ["diff", "HEAD"])) + status;

  return `${head}+${hash(dirty).slice(0, 10)}`;
}

async function resolveSession(sessionId: string): Promise<ResolvedTarget> {
  const session = appState.sessions.get(sessionId);
  if (!session) {
    throw `Session not found: ${sessionId}`;
  }
  const cwd = session.path;
  const baseName = session.base_branch ?? "main";
  const base = await sessionBase(cwd, baseName);
  const mergeBase = (await git(cwd, ["merge-base", base, "HEAD"])).trim();
  const patch =
    (await git(cwd, ["diff", "--no-color", "--no-ext-diff", mergeBase])) +
    (await untrackedPatch(cwd));

  return {
    headSha: await sessionHead(sessionId),
    baseRef: baseName,
    patch,
    cwd,
    subject: `the changes on the branch \`${session.branch}\``,
    description: session.description || undefined,
  };
}

/** A registered project whose remote is `repo`, and that remote's name. */
async function localClone(
  repo: string,
): Promise<{ root: string; remote: string; ref: RepoRef }> {
  const want = repo.toLowerCase();
  for (const root of appState.repoRoots) {
    for (const { remote, ref } of await remoteRepoRefs(root)) {
      if (ref.path.toLowerCase() === want) {
        return { root, remote, ref };
      }
    }
  }
  throw `No project here is a clone of ${repo}. Add it as a project to write a guide for its pull requests.`;
}

async function fetchRef(
  root: string,
  remote: string,
  ref: string,
): Promise<string> {
  await git(root, ["fetch", "--no-tags", remote, ref]);
  const sha = await revParse(root, "FETCH_HEAD");
  if (!sha) {
    throw `Couldn't fetch ${ref} from ${remote}.`;
  }

  return sha;
}

/** A detached checkout of `sha`, reused across guides of the same pull request. */
async function checkout(
  root: string,
  repo: string,
  number: number,
  sha: string,
): Promise<string> {
  const dir = path.join(
    guidesDir(),
    "checkouts",
    `${repo.replaceAll("/", "-")}-${number}`,
  );
  const registered = (
    await git(root, ["worktree", "list", "--porcelain"])
  ).includes(`worktree ${dir}\n`);
  if (registered && fs.existsSync(dir)) {
    await git(dir, ["checkout", "--detach", "--force", sha]);
  } else {
    fs.rmSync(dir, { recursive: true, force: true });
    await git(root, ["worktree", "prune"]);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    await git(root, ["worktree", "add", "--detach", dir, sha]);
  }

  return dir;
}

/** A clean session worktree already at `sha`: no reason to check it out twice. */
async function sessionAt(sha: string): Promise<string | null> {
  for (const session of appState.sessions.values()) {
    const head = await revParse(session.path, "HEAD").catch(() => null);
    if (
      head === sha &&
      !(await git(session.path, ["status", "--porcelain"]).catch(() => "x"))
    ) {
      return session.path;
    }
  }

  return null;
}

async function resolvePullRequest(
  repo: string,
  number: number,
): Promise<ResolvedTarget> {
  const { root, remote, ref } = await localClone(repo);
  const host = codeHost(ref.kind);
  const pr = await host.detail(ref, number).catch((e: unknown) => {
    throw `Couldn't read ${host.noun} #${number} on ${host.label}: ${e instanceof Error ? e.message : String(e)}`;
  });
  const head = await fetchRef(root, remote, host.headRef(number));
  const base = await fetchRef(root, remote, pr.baseRefName);
  const mergeBase = (await git(root, ["merge-base", base, head])).trim();
  const patch = await git(root, [
    "diff",
    "--no-color",
    "--no-ext-diff",
    mergeBase,
    head,
  ]);
  const cwd =
    (await sessionAt(head)) ?? (await checkout(root, repo, number, head));

  return {
    headSha: head,
    baseRef: pr.baseRefName,
    patch,
    cwd,
    subject: `${host.noun} #${number}: ${pr.title}`,
    description: pr.body || undefined,
  };
}

export function resolveTarget(target: GuideTarget): Promise<ResolvedTarget> {
  return target.kind === "session"
    ? resolveSession(target.sessionId)
    : resolvePullRequest(target.repo, target.number);
}
