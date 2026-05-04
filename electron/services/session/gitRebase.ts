/**
 * Phase 7 T2 — interactive rebase planning + execution.
 *
 * `git_rebase_interactive_plan` is read-only: returns the list of commits in
 * `<upstream>..HEAD`, oldest-first, ready for the renderer to drop into the
 * `<RebaseEditor>` Peacock primitive.
 *
 * `git_rebase_interactive_run` writes a node-based shim script to the OS temp
 * directory and points `GIT_SEQUENCE_EDITOR` at it. The shim copies the
 * pre-baked todo file over the path git invokes the editor with. A second
 * shim swaps in `reword` subjects via `GIT_EDITOR`.
 *
 * Both endpoints gate on `kind === "project_root"` — running an interactive
 * rebase from a session worktree would corrupt the agent's branch.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { appState } from "../../state";
import { git } from "./git";
import { classifyGitStderr, GitError } from "./gitError";
import { withGitLock } from "./gitLock";

const execFileAsync = promisify(execFile);

function requireProjectScope(id: string): { path: string } {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw new GitError("unknown", `Session not found: ${id}`);
  }
  if (ws.kind !== "project_root") {
    throw new GitError(
      "unknown",
      "Interactive rebase is only available on the project root",
    );
  }

  return { path: ws.path };
}

export type RebaseAction =
  | "drop"
  | "edit"
  | "fixup"
  | "pick"
  | "reword"
  | "squash";

export interface RebasePlanCommit {
  author: string;
  hash: string;
  subject: string;
}

export interface RebasePlanEntry {
  action: RebaseAction;
  hash: string;
  newSubject?: string;
}

const FIELD_SEP = "\x1f";
const RECORD_SEP = "\x1e";

/**
 * Read-only — list commits in `<upstream>..HEAD`, oldest first (the order
 * `git rebase -i` will present them in).
 */
export async function gitRebaseInteractivePlan(
  id: string,
  opts: { upstream: string },
): Promise<RebasePlanCommit[]> {
  const { path: cwd } = requireProjectScope(id);
  if (!opts.upstream.trim()) {
    throw new GitError("unknown", "Upstream ref is required");
  }
  const fmt = ["%H", "%s", "%an"].join(FIELD_SEP);
  const out = await git(cwd, [
    "log",
    `--format=${fmt}${RECORD_SEP}`,
    "--reverse",
    `${opts.upstream}..HEAD`,
  ]);

  return out
    .split(RECORD_SEP)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((line) => {
      const [hash = "", subject = "", author = ""] = line.split(FIELD_SEP);

      return { hash, subject, author };
    });
}

interface ShimSetup {
  cleanup: () => void;
  env: Record<string, string>;
}

/**
 * Build the tiny node scripts git will invoke as `GIT_SEQUENCE_EDITOR` /
 * `GIT_EDITOR`. The sequence editor copies a prepared todo file over the
 * argv-supplied path. The editor (for reword) writes the prepared subject
 * into the commit-message file when one is queued for the current commit.
 *
 * The reword subjects map is keyed by the *first line* of the existing
 * commit message — we read the message from the file git passes us and
 * look it up. This avoids needing to know git's internal cherry-pick state.
 */
function buildShims(opts: {
  todoBody: string;
  rewords: Record<string, string>;
}): ShimSetup {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "argus-rebase-"));
  const todoPath = path.join(dir, "todo");
  const rewordsPath = path.join(dir, "rewords.json");
  const seqShim = path.join(dir, "seq-editor.js");
  const msgShim = path.join(dir, "msg-editor.js");

  fs.writeFileSync(todoPath, opts.todoBody, "utf8");
  fs.writeFileSync(rewordsPath, JSON.stringify(opts.rewords), "utf8");

  // Sequence editor: copy our prepared todo over the file argv[2].
  fs.writeFileSync(
    seqShim,
    `#!/usr/bin/env node
const fs = require("fs");
const target = process.argv[2];
if (!target) { process.exit(0); }
const todo = fs.readFileSync(${JSON.stringify(todoPath)}, "utf8");
fs.writeFileSync(target, todo);
`,
    "utf8",
  );

  // Message editor: when git invokes us for a commit message, read the file,
  // take the first non-comment line as the lookup key, and if a reword is
  // queued for it, replace the file with the new subject.
  fs.writeFileSync(
    msgShim,
    `#!/usr/bin/env node
const fs = require("fs");
const target = process.argv[2];
if (!target) { process.exit(0); }
const rewords = JSON.parse(fs.readFileSync(${JSON.stringify(rewordsPath)}, "utf8"));
let body;
try { body = fs.readFileSync(target, "utf8"); } catch (e) { process.exit(0); }
const firstLine = body.split(/\\r?\\n/).find((l) => l.length > 0 && !l.startsWith("#")) || "";
const replacement = rewords[firstLine.trim()];
if (replacement) {
  fs.writeFileSync(target, replacement + "\\n");
}
`,
    "utf8",
  );

  fs.chmodSync(seqShim, 0o755);
  fs.chmodSync(msgShim, 0o755);

  const env = {
    GIT_SEQUENCE_EDITOR: `node ${seqShim}`,
    GIT_EDITOR: `node ${msgShim}`,
  };

  const cleanup = () => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  };

  return { env, cleanup };
}

/**
 * Build the contents of the `git rebase -i` todo file from a plan. The plan
 * is in execution order (oldest first); the file format is:
 *
 *   pick <hash> <subject>
 *   reword <hash> <subject>
 *   ...
 */
function buildTodo(
  plan: RebasePlanEntry[],
  commitsByHash: Map<string, RebasePlanCommit>,
): string {
  const lines: string[] = [];
  for (const entry of plan) {
    const c = commitsByHash.get(entry.hash);
    if (!c) {
      throw new GitError(
        "unknown",
        `Plan references unknown commit ${entry.hash}`,
      );
    }
    // git accepts short hashes in the todo file, but using the full hash is
    // unambiguous.
    lines.push(`${entry.action} ${c.hash} ${c.subject}`);
  }

  return lines.join("\n") + "\n";
}

export async function gitRebaseInteractiveRun(
  id: string,
  opts: { plan: RebasePlanEntry[]; upstream: string },
): Promise<void> {
  const { path: cwd } = requireProjectScope(id);
  if (!opts.upstream.trim()) {
    throw new GitError("unknown", "Upstream ref is required");
  }
  if (!Array.isArray(opts.plan) || opts.plan.length === 0) {
    throw new GitError("unknown", "Rebase plan is empty");
  }

  // Re-read commits from the repo so we have authoritative subjects (the
  // renderer's view may be stale).
  const commits = await gitRebaseInteractivePlan(id, {
    upstream: opts.upstream,
  });
  const byHash = new Map<string, RebasePlanCommit>();
  for (const c of commits) {
    byHash.set(c.hash, c);
  }

  // Build a reword map keyed by the original first-line subject. If two
  // commits happen to share a subject and only one is being reworded, we
  // accept that the message-editor shim may match the wrong instance — but
  // that's a corner case; commit subjects are usually distinctive within a
  // rebase range.
  const rewords: Record<string, string> = {};
  for (const entry of opts.plan) {
    if (entry.action === "reword" && entry.newSubject) {
      const c = byHash.get(entry.hash);
      if (c) {
        rewords[c.subject] = entry.newSubject;
      }
    }
  }

  const todoBody = buildTodo(opts.plan, byHash);
  const shims = buildShims({ todoBody, rewords });

  await withGitLock(cwd, async () => {
    try {
      await execFileAsync("git", ["rebase", "-i", opts.upstream], {
        cwd,
        env: { ...process.env, ...shims.env },
      });
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      const stderr = e.stderr ?? "";
      const stdout = e.stdout ?? "";
      const combined = stderr || stdout || e.message || "git rebase -i failed";
      // If the rebase halted mid-flight (e.g. a conflict while replaying a
      // commit on top of a squash), abort it so the working tree is restored
      // rather than leaving the user stranded in a detached rebase state.
      try {
        await execFileAsync("git", ["rebase", "--abort"], { cwd });
      } catch {
        // Either no rebase in progress or abort failed — surface the
        // original error either way.
      }
      throw classifyGitStderr(combined, { op: "rebase" });
    } finally {
      shims.cleanup();
    }
  });
}

/**
 * Run `git rebase -i --autosquash <upstream>` non-interactively, accepting
 * the auto-generated todo. Used by the autosquash banner to fold any
 * `fixup!` / `squash!` commits into their targets in one click.
 */
export async function gitRebaseAutosquash(
  id: string,
  opts: { upstream: string },
): Promise<void> {
  const { path: cwd } = requireProjectScope(id);
  if (!opts.upstream.trim()) {
    throw new GitError("unknown", "Upstream ref is required");
  }

  await withGitLock(cwd, async () => {
    try {
      await execFileAsync(
        "git",
        [
          "-c",
          "sequence.editor=true",
          "-c",
          "rebase.autosquash=true",
          "rebase",
          "-i",
          opts.upstream,
        ],
        {
          cwd,
          env: { ...process.env, GIT_EDITOR: "true" },
        },
      );
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      const stderr = e.stderr ?? "";
      const stdout = e.stdout ?? "";
      const combined =
        stderr || stdout || e.message || "git rebase --autosquash failed";
      throw classifyGitStderr(combined, { op: "rebase" });
    }
  });
}
