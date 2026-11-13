/**
 * Pull requests, narrowed for a phone.
 *
 * A paired desktop drives `gh` through the admin passthrough and gets the
 * whole `PullRequestDetail`, files and inline review threads included. A phone
 * wants to know whether CI is green, what was said, and whether it can hit
 * merge — so this maps the host records onto the small wire shapes in
 * `@argus/remote-protocol` and nothing more.
 *
 * Every method here is `denied` for a scoped grant (see `METHOD_SCOPE`): a
 * huddle guest reviews the agent it was handed, it does not speak on GitHub.
 */

import type { MergeStrategy } from "../github/prActions";
import type { PullRequestDetail } from "../github/prDetail";
import type { InterestingPullRequest } from "../github/pullRequests";
import type {
  RemotePullRequest,
  RemotePullRequestDetail,
} from "@argus/remote-protocol";
import { appState } from "../../state";
import { ghPrComment, ghPrCreate, ghPrMerge } from "../github/prActions";
import { getPullRequestDetail, getPullRequestDiff } from "../github/prDetail";
import { listInterestingPullRequests } from "../github/pullRequests";
import {
  getPullRequestViewedFiles,
  setPullRequestFileViewed,
  type ViewedFile,
} from "../github/viewedFiles";
import { autofillPullRequest } from "../session/prAutofill";
import { readPullRequestTemplate } from "../session/pullRequest";
import { capture } from "../telemetry/telemetry";

function toRemotePullRequest(pr: InterestingPullRequest): RemotePullRequest {
  return {
    number: pr.number,
    title: pr.title,
    repo: pr.repoNameWithOwner,
    repo_root: pr.repoRoot,
    author: pr.author,
    is_draft: pr.isDraft,
    review_decision: pr.reviewDecision,
    head_ref: pr.headRefName,
    base_ref: pr.baseRefName,
    url: pr.url,
    updated_at: pr.updatedAt,
    reasons: pr.reasons,
  };
}

function toRemotePullRequestDetail(
  pr: PullRequestDetail,
): RemotePullRequestDetail {
  return {
    number: pr.number,
    title: pr.title,
    repo: pr.repoNameWithOwner,
    url: pr.url,
    author: pr.author,
    body: pr.body,
    state: pr.state,
    is_draft: pr.isDraft,
    merged: pr.merged,
    mergeable: pr.mergeable,
    head_ref: pr.headRefName,
    base_ref: pr.baseRefName,
    additions: pr.additions,
    deletions: pr.deletions,
    changed_files: pr.changedFiles,
    checks: pr.checks.map((check) => ({
      name: check.name,
      status: check.status,
      conclusion: check.conclusion,
    })),
    // Inline review threads are dropped: a phone reads the conversation, it
    // does not review line by line.
    comments: pr.comments.map((comment) => ({
      id: comment.id,
      author: comment.author,
      body: comment.body,
      created_at: comment.createdAt,
      kind: comment.kind,
      review_state: comment.reviewState ?? null,
    })),
  };
}

/** `owner/repo` is how the wire addresses a PR; `gh` wants the halves. */
function splitRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw `Not an owner/repo slug: ${repo}`;
  }

  return { owner, name };
}

export async function remotePullRequests(repoRoots: string[]): Promise<{
  pull_requests: RemotePullRequest[];
}> {
  const prs = await listInterestingPullRequests(repoRoots);

  return { pull_requests: prs.map(toRemotePullRequest) };
}

export async function remotePullRequest(
  repo: string,
  number: number,
): Promise<{ pull_request: RemotePullRequestDetail }> {
  const { owner, name } = splitRepo(repo);

  return {
    pull_request: toRemotePullRequestDetail(
      await getPullRequestDetail(owner, name, number),
    ),
  };
}

/**
 * Open a PR for a session's branch. The base and head come off the session
 * rather than the client — a phone knows which work it is looking at, not
 * which refs that means.
 */
export async function createRemotePullRequest(params: {
  body: string;
  draft: boolean;
  sessionId: string;
  title: string;
}): Promise<{ number: number; url: string }> {
  const session = appState.sessions.get(params.sessionId);
  if (!session) {
    throw `Session not found: ${params.sessionId}`;
  }
  if (!session.branch) {
    throw "This session has no branch to open a pull request for.";
  }
  if (!session.base_branch) {
    throw "This session has no base branch set.";
  }

  return await ghPrCreate({
    repoRoot: session.repo_root,
    title: params.title,
    body: params.body,
    base: session.base_branch,
    head: session.branch,
    draft: params.draft,
  });
}

function sessionFor(sessionId: string) {
  const session = appState.sessions.get(sessionId);
  if (!session) {
    throw `Session not found: ${sessionId}`;
  }

  return session;
}

export function remotePullRequestTemplate(sessionId: string): {
  template: string | null;
} {
  return { template: readPullRequestTemplate(sessionFor(sessionId).repo_root) };
}

/** The same one-shot the desktop's "Fill in with Claude" runs. */
export async function fillRemotePullRequest(
  sessionId: string,
  title: string,
): Promise<{ body: string | null; title: string | null }> {
  const session = sessionFor(sessionId);
  const draft = await autofillPullRequest({
    sessionId,
    title,
    baseBranch: session.base_branch ?? "main",
  });

  return { body: draft?.body ?? null, title: draft?.title || null };
}

export async function mergeRemotePullRequest(
  repo: string,
  number: number,
  strategy: MergeStrategy,
): Promise<{ accepted: boolean }> {
  const { owner, name } = splitRepo(repo);
  await ghPrMerge({ owner, repo: name, number, strategy });

  return { accepted: true };
}

export async function commentOnRemotePullRequest(
  repo: string,
  number: number,
  body: string,
): Promise<{ accepted: boolean }> {
  const { owner, name } = splitRepo(repo);
  await ghPrComment({ owner, repo: name, number, body });

  return { accepted: true };
}

export async function remotePullRequestDiff(
  repo: string,
  number: number,
): Promise<{ diff: string }> {
  const { owner, name } = splitRepo(repo);

  return { diff: await getPullRequestDiff(owner, name, number) };
}

export async function remotePullRequestViewedFiles(
  repo: string,
  number: number,
): Promise<{ files: ViewedFile[] }> {
  const { owner, name } = splitRepo(repo);

  return { files: await getPullRequestViewedFiles(owner, name, number) };
}

export async function setRemotePullRequestFileViewed(params: {
  number: number;
  path: string;
  repo: string;
  viewed: boolean;
}): Promise<{ files: ViewedFile[] }> {
  const { owner, name } = splitRepo(params.repo);
  await setPullRequestFileViewed({ ...params, owner, repo: name });
  capture("diff_file_viewed", {
    source: "pull_request",
    viewed: params.viewed,
  });

  return remotePullRequestViewedFiles(params.repo, params.number);
}
