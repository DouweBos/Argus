/**
 * Mutating GitHub PR actions — create, comment, merge, close — all via the
 * `gh` CLI. Each function throws a descriptive string when `gh` is not
 * installed or the user is not authenticated, matching the pattern used
 * throughout the rest of the github services.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prReferenceSection } from "../design/prSection";
import { pullRequestOpened } from "../integrations/report";
import {
  requestSessionPullRequestRefresh,
  sessionPullRequestMayHaveChanged,
} from "./sessionPullRequests";

const execFileAsync = promisify(execFile);

export type MergeStrategy = "merge" | "rebase" | "squash";

/**
 * Create a pull request via `gh pr create`.
 *
 * @param repoRoot - Absolute path to the repo's working tree. The `gh` CLI is
 *   invoked with `cwd = repoRoot` so it picks up the correct remote context
 *   without needing an explicit `--repo` flag (which would require us to know
 *   the slug up-front — but `gh` discovers it from the remote automatically).
 * @returns `{ url, number }` for the newly-created PR.
 */
export async function ghPrCreate(params: {
  base: string;
  body: string;
  draft: boolean;
  head: string;
  repoRoot: string;
  title: string;
}): Promise<{ number: number; url: string }> {
  const { repoRoot, title, base, head, draft } = params;
  const references = prReferenceSection(repoRoot, head);
  const body = references
    ? `${params.body.trimEnd()}\n\n${references}`
    : params.body;
  const args = [
    "pr",
    "create",
    "--title",
    title,
    "--body",
    body,
    "--base",
    base,
    "--head",
    head,
  ];
  if (draft) {
    args.push("--draft");
  }

  let stdout: string;
  try {
    const result = await execFileAsync("gh", args, {
      cwd: repoRoot,
      maxBuffer: 1024 * 1024,
    });
    stdout = result.stdout;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("command not found") || msg.includes("ENOENT")) {
      throw "gh CLI is not installed. Install it from https://cli.github.com and run `gh auth login`.";
    }
    if (
      msg.includes("not logged into") ||
      msg.includes("authentication") ||
      msg.includes("401")
    ) {
      throw "Not authenticated with GitHub. Run `gh auth login` to sign in.";
    }
    throw msg;
  }

  const url = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^https?:\/\/[^\s]+\/pull\/\d+/.test(line));
  if (!url) {
    throw `gh pr create did not return a PR URL. Output: ${stdout.trim()}`;
  }
  const match = /\/pull\/(\d+)/.exec(url);
  if (!match) {
    throw `Could not parse PR number from URL: ${url}`;
  }
  const number = Number(match[1]);
  pullRequestOpened(repoRoot, head, url);
  requestSessionPullRequestRefresh([repoRoot], { force: true });

  return { url, number };
}

/**
 * Post a comment on an existing pull request.
 */
export async function ghPrComment(params: {
  body: string;
  number: number;
  owner: string;
  repo: string;
}): Promise<void> {
  const { owner, repo, number, body } = params;
  try {
    await execFileAsync(
      "gh",
      [
        "pr",
        "comment",
        String(number),
        "--body",
        body,
        "--repo",
        `${owner}/${repo}`,
      ],
      { maxBuffer: 1024 * 1024 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("command not found") || msg.includes("ENOENT")) {
      throw "gh CLI is not installed. Install it from https://cli.github.com and run `gh auth login`.";
    }
    if (
      msg.includes("not logged into") ||
      msg.includes("authentication") ||
      msg.includes("401")
    ) {
      throw "Not authenticated with GitHub. Run `gh auth login` to sign in.";
    }
    throw msg;
  }
}

/**
 * Merge a pull request using the given strategy.
 */
export async function ghPrMerge(params: {
  number: number;
  owner: string;
  repo: string;
  strategy: MergeStrategy;
}): Promise<void> {
  const { owner, repo, number, strategy } = params;
  let strategyFlag: string;
  if (strategy === "squash") {
    strategyFlag = "--squash";
  } else if (strategy === "rebase") {
    strategyFlag = "--rebase";
  } else {
    strategyFlag = "--merge";
  }
  try {
    await execFileAsync(
      "gh",
      [
        "pr",
        "merge",
        String(number),
        strategyFlag,
        "--repo",
        `${owner}/${repo}`,
      ],
      { maxBuffer: 1024 * 1024 },
    );
    sessionPullRequestMayHaveChanged();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("command not found") || msg.includes("ENOENT")) {
      throw "gh CLI is not installed. Install it from https://cli.github.com and run `gh auth login`.";
    }
    if (
      msg.includes("not logged into") ||
      msg.includes("authentication") ||
      msg.includes("401")
    ) {
      throw "Not authenticated with GitHub. Run `gh auth login` to sign in.";
    }
    throw msg;
  }
}

/**
 * Close a pull request without merging.
 */
export async function ghPrClose(params: {
  number: number;
  owner: string;
  repo: string;
}): Promise<void> {
  const { owner, repo, number } = params;
  try {
    await execFileAsync(
      "gh",
      ["pr", "close", String(number), "--repo", `${owner}/${repo}`],
      { maxBuffer: 1024 * 1024 },
    );
    sessionPullRequestMayHaveChanged();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("command not found") || msg.includes("ENOENT")) {
      throw "gh CLI is not installed. Install it from https://cli.github.com and run `gh auth login`.";
    }
    if (
      msg.includes("not logged into") ||
      msg.includes("authentication") ||
      msg.includes("401")
    ) {
      throw "Not authenticated with GitHub. Run `gh auth login` to sign in.";
    }
    throw msg;
  }
}
