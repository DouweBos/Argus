/**
 * Pull requests across code hosts: what commands, the gateway and MCP tools
 * call. Each call finds the repo's host from the project's remotes and hands
 * off to it, then nudges the session PR cache.
 */

import type { NewPullRequest } from "./hosts";
import type { RepoRef } from "./remoteUrl";
import type { GhIssue } from "../github/issues";
import type { MergeStrategy } from "../github/prActions";
import type { PullRequestDetail } from "../github/prDetail";
import type { PullRequestReview } from "../github/prReview";
import type { InterestingPullRequest } from "../github/pullRequests";
import { prReferenceSection } from "../design/prSection";
import { listInterestingPullRequests as listGithubPullRequests } from "../github/pullRequests";
import {
  requestSessionPullRequestRefresh,
  sessionPullRequestMayHaveChanged,
} from "../github/sessionPullRequests";
import {
  getPullRequestViewedFiles as getGithubViewedFiles,
  setPullRequestFileViewed as setGithubFileViewed,
  type ViewedFile,
} from "../github/viewedFiles";
import { listInterestingMergeRequests } from "../gitlab/mergeRequests";
import { pullRequestOpened } from "../integrations/report";
import { capture } from "../telemetry/telemetry";
import { codeHost } from "./hosts";
import { gitlabRepoRefs, preferredRepoRef, resolveRepoSlug } from "./repos";

/**
 * No GitHub/GitLab remote: still `gh`, which reads GitHub Enterprise remotes
 * from the checkout itself.
 */
const UNKNOWN_REPO: RepoRef = { kind: "github", host: "github.com", path: "" };

/** `owner` + `repo` as the wire sends them; a GitLab group path may sit in `owner`. */
async function resolve(owner: string, repo: string): Promise<RepoRef> {
  return resolveRepoSlug(`${owner}/${repo}`);
}

async function listGitlab(
  repoRoots: string[],
): Promise<InterestingPullRequest[]> {
  const byHost = new Map<string, Map<string, string>>();
  for (const root of repoRoots) {
    for (const ref of await gitlabRepoRefs(root)) {
      const paths = byHost.get(ref.host) ?? new Map<string, string>();
      byHost.set(ref.host, paths);
      paths.set(ref.path.toLowerCase(), root);
    }
  }
  const lists = await Promise.all(
    [...byHost].map(([host, paths]) =>
      listInterestingMergeRequests(host, paths),
    ),
  );

  return lists.flat();
}

/**
 * Open PRs and MRs of interest across every host the projects use. One host
 * failing doesn't hide the others; it only throws when nothing answered.
 */
export async function listInterestingPullRequests(
  repoRoots: string[],
): Promise<InterestingPullRequest[]> {
  const results = await Promise.allSettled([
    listGithubPullRequests(repoRoots),
    listGitlab(repoRoots),
  ]);
  const ok = results.filter(
    (r): r is PromiseFulfilledResult<InterestingPullRequest[]> =>
      r.status === "fulfilled",
  );
  const failed = results.find(
    (r): r is PromiseRejectedResult => r.status === "rejected",
  );
  if (failed && ok.every((r) => r.value.length === 0)) {
    throw failed.reason instanceof Error
      ? failed.reason.message
      : failed.reason;
  }

  return ok
    .flatMap((r) => r.value)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getPullRequestDetail(
  owner: string,
  repo: string,
  number: number,
): Promise<PullRequestDetail> {
  const ref = await resolve(owner, repo);

  return codeHost(ref.kind).detail(ref, number);
}

export async function getPullRequestDiff(
  owner: string,
  repo: string,
  number: number,
): Promise<string> {
  const ref = await resolve(owner, repo);

  return codeHost(ref.kind).diff(ref, number);
}

/** Opens it on the branch's own remote, with the ticket and designs appended. */
export async function createPullRequest(
  params: NewPullRequest & { repoRoot: string },
): Promise<{ number: number; url: string }> {
  const { repoRoot, head } = params;
  const ref = await preferredRepoRef(repoRoot, head);
  const references = prReferenceSection(repoRoot, head);
  const body = references
    ? `${params.body.trimEnd()}\n\n${references}`
    : params.body;
  const target = ref ?? UNKNOWN_REPO;
  const created = await codeHost(target.kind).create(target, repoRoot, {
    ...params,
    body,
  });
  pullRequestOpened(repoRoot, head, created.url);
  requestSessionPullRequestRefresh([repoRoot], { force: true });

  return created;
}

export async function commentOnPullRequest(params: {
  body: string;
  number: number;
  owner: string;
  repo: string;
}): Promise<void> {
  const ref = await resolve(params.owner, params.repo);
  await codeHost(ref.kind).comment(ref, params.number, params.body);
}

function commentsBucket(n: number): "0" | "1-5" | "6-20" | "21+" {
  if (n === 0) {
    return "0";
  }
  if (n <= 5) {
    return "1-5";
  }

  return n <= 20 ? "6-20" : "21+";
}

/** One review with line comments, on whichever host the repo lives. */
export async function reviewPullRequest(
  params: PullRequestReview & { number: number; owner: string; repo: string },
): Promise<void> {
  const ref = await resolve(params.owner, params.repo);
  const event = {
    APPROVE: "approve",
    COMMENT: "comment",
    REQUEST_CHANGES: "request_changes",
  } as const;
  const props = {
    event: event[params.event],
    host: ref.kind,
    comments_bucket: commentsBucket(params.comments.length),
  };
  try {
    await codeHost(ref.kind).review(ref, params.number, params);
    capture("pull_request_reviewed", { ...props, success: true });
  } catch (e) {
    capture("pull_request_reviewed", { ...props, success: false });
    throw e;
  }
  sessionPullRequestMayHaveChanged();
}

export async function mergePullRequest(params: {
  number: number;
  owner: string;
  repo: string;
  strategy: MergeStrategy;
}): Promise<void> {
  const ref = await resolve(params.owner, params.repo);
  await codeHost(ref.kind).merge(ref, params.number, params.strategy);
  sessionPullRequestMayHaveChanged();
}

export async function closePullRequest(params: {
  number: number;
  owner: string;
  repo: string;
}): Promise<void> {
  const ref = await resolve(params.owner, params.repo);
  await codeHost(ref.kind).close(ref, params.number);
  sessionPullRequestMayHaveChanged();
}

/** Open issues in the project's own repo; empty when its host's CLI can't say. */
export async function listIssues(repoRoot: string): Promise<GhIssue[]> {
  const ref = (await preferredRepoRef(repoRoot)) ?? UNKNOWN_REPO;

  return codeHost(ref.kind).issues(ref, repoRoot);
}

/** Whether CI on the branch's PR is green; null when unknowable. */
export async function branchChecksClean(
  repoRoot: string,
  branch: string,
): Promise<boolean | null> {
  const ref = (await preferredRepoRef(repoRoot, branch)) ?? UNKNOWN_REPO;

  return codeHost(ref.kind).checksClean(ref, repoRoot, branch);
}

/** GitHub's "Viewed" checkboxes; GitLab keeps those in the browser only, so it has none to share. */
export async function getPullRequestViewedFiles(
  owner: string,
  repo: string,
  number: number,
): Promise<ViewedFile[]> {
  const ref = await resolve(owner, repo);

  return ref.kind === "github" ? getGithubViewedFiles(owner, repo, number) : [];
}

export async function setPullRequestFileViewed(params: {
  number: number;
  owner: string;
  path: string;
  repo: string;
  viewed: boolean;
}): Promise<void> {
  const ref = await resolve(params.owner, params.repo);
  if (ref.kind === "github") {
    await setGithubFileViewed(params);
  }
}
