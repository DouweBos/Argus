/**
 * The code-host seam: one pull/merge request on GitHub (through `gh`) or
 * GitLab (through `glab`), behind the same interface. Cross-repo work — the
 * Pull Requests list, each session's PR — lives in `pullRequests.ts` and
 * `../github/sessionPullRequests.ts`, which group repos by host.
 */

import type { CodeHostKind, RepoRef } from "./remoteUrl";
import type { GhIssue } from "../github/issues";
import type { MergeStrategy } from "../github/prActions";
import type { PullRequestDetail } from "../github/prDetail";
import type { PullRequestReview } from "../github/prReview";
import type { PrSnapshot } from "../github/prWatch/snapshot";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { branchChecksClean } from "../github/checks";
import { listGhIssues } from "../github/issues";
import {
  ghPrClose,
  ghPrComment,
  ghPrCreate,
  ghPrMerge,
  ghPrMergeInCheckout,
  ghPrRetarget,
} from "../github/prActions";
import { getPullRequestDetail, getPullRequestDiff } from "../github/prDetail";
import { ghPrReview } from "../github/prReview";
import { failedLogExcerpt, fetchPrSnapshot } from "../github/prWatch/fetch";
import { gitlabJobLogExcerpt } from "../gitlab/jobs";
import { openMergeRequestForBranch } from "../gitlab/mergeRequests";
import {
  closeMergeRequest,
  commentOnMergeRequest,
  createMergeRequest,
  listGitlabIssues,
  mergeMergeRequest,
  retargetMergeRequest,
} from "../gitlab/mrActions";
import { getMergeRequestDetail, getMergeRequestDiff } from "../gitlab/mrDetail";
import { reviewMergeRequest } from "../gitlab/mrReview";
import { fetchMrSnapshot, gitlabBranchChecksClean } from "../gitlab/mrWatch";

const execFileAsync = promisify(execFile);

export interface NewPullRequest {
  base: string;
  body: string;
  draft: boolean;
  head: string;
  title: string;
}

export interface CodeHost {
  kind: CodeHostKind;
  /** "GitHub", "GitLab" — for messages people read. */
  label: string;
  /** What the host calls one: "pull request", "merge request". */
  noun: string;
  detail: (ref: RepoRef, number: number) => Promise<PullRequestDetail>;
  diff: (ref: RepoRef, number: number) => Promise<string>;
  /** `cwd` is a checkout of `ref`, for CLIs that read the repo from it. */
  create: (
    ref: RepoRef,
    cwd: string,
    params: NewPullRequest,
  ) => Promise<{ number: number; url: string }>;
  comment: (ref: RepoRef, number: number, body: string) => Promise<void>;
  /** Line comments, a summary and a verdict, posted as one review. */
  review: (
    ref: RepoRef,
    number: number,
    review: PullRequestReview,
  ) => Promise<void>;
  /** The ref `git fetch` reads the head from: `pull/12/head`, `merge-requests/12/head`. */
  headRef: (number: number) => string;
  merge: (
    ref: RepoRef,
    number: number,
    strategy: MergeStrategy,
  ) => Promise<void>;
  close: (ref: RepoRef, number: number) => Promise<void>;
  /** Point it at a different base branch; `cwd` is a checkout of `ref`. */
  retarget: (
    ref: RepoRef,
    cwd: string,
    number: number,
    base: string,
  ) => Promise<void>;
  /** Merge it from a checkout, for a repo only the checkout can name (GitHub Enterprise). */
  mergeInCheckout: (
    ref: RepoRef,
    cwd: string,
    number: number,
    strategy: MergeStrategy,
  ) => Promise<void>;
  /** Empty when the CLI is missing or signed out. */
  issues: (ref: RepoRef, cwd: string) => Promise<GhIssue[]>;
  /** Null — not false — when CI state is unknowable. */
  checksClean: (
    ref: RepoRef,
    cwd: string,
    branch: string,
  ) => Promise<boolean | null>;
  /** The open one from `branch`, for watching a PR Argus hasn't seen yet. */
  openForBranch: (
    ref: RepoRef,
    cwd: string,
    branch: string,
  ) => Promise<{ number: number; url: string } | null>;
  snapshot: (ref: RepoRef, number: number) => Promise<PrSnapshot>;
  /** The tail of a failed check's log from its details URL; null when not available. */
  failedLog: (detailsUrl: string | null) => Promise<string | null>;
}

function halves(ref: RepoRef): { owner: string; repo: string } {
  const [owner, repo] = ref.path.split("/");

  return { owner: owner!, repo: repo! };
}

export const githubHost: CodeHost = {
  kind: "github",
  label: "GitHub",
  noun: "pull request",
  detail: (ref, number) => {
    const { owner, repo } = halves(ref);

    return getPullRequestDetail(owner, repo, number);
  },
  diff: (ref, number) => {
    const { owner, repo } = halves(ref);

    return getPullRequestDiff(owner, repo, number);
  },
  create: (_ref, cwd, params) => ghPrCreate({ ...params, repoRoot: cwd }),
  comment: (ref, number, body) => ghPrComment({ ...halves(ref), number, body }),
  review: (ref, number, review) => ghPrReview(ref.path, number, review),
  headRef: (number) => `pull/${number}/head`,
  merge: (ref, number, strategy) =>
    ghPrMerge({ ...halves(ref), number, strategy }),
  close: (ref, number) => ghPrClose({ ...halves(ref), number }),
  retarget: (_ref, cwd, number, base) => ghPrRetarget(cwd, number, base),
  mergeInCheckout: (_ref, cwd, number, strategy) =>
    ghPrMergeInCheckout(cwd, number, strategy),
  issues: (_ref, cwd) => listGhIssues(cwd),
  checksClean: (_ref, cwd, branch) => branchChecksClean(cwd, branch),
  async openForBranch(_ref, cwd, branch) {
    try {
      const { stdout } = await execFileAsync(
        "gh",
        ["pr", "view", branch, "--json", "url,state,number"],
        { cwd },
      );
      const view = JSON.parse(stdout) as {
        number?: number;
        state?: string;
        url?: string;
      };

      return view.state === "OPEN" && view.url && view.number
        ? { number: view.number, url: view.url }
        : null;
    } catch {
      return null;
    }
  },
  snapshot: (ref, number) => {
    const { owner, repo } = halves(ref);

    return fetchPrSnapshot(owner, repo, number);
  },
  failedLog: failedLogExcerpt,
};

export const gitlabHost: CodeHost = {
  kind: "gitlab",
  label: "GitLab",
  noun: "merge request",
  detail: getMergeRequestDetail,
  diff: getMergeRequestDiff,
  create: (ref, _cwd, params) => createMergeRequest(ref, params),
  comment: commentOnMergeRequest,
  review: reviewMergeRequest,
  headRef: (number) => `merge-requests/${number}/head`,
  merge: mergeMergeRequest,
  close: closeMergeRequest,
  retarget: (ref, _cwd, number, base) =>
    retargetMergeRequest(ref, number, base),
  mergeInCheckout: (ref, _cwd, number, strategy) =>
    mergeMergeRequest(ref, number, strategy),
  issues: (ref) => listGitlabIssues(ref).catch(() => []),
  checksClean: (ref, _cwd, branch) => gitlabBranchChecksClean(ref, branch),
  openForBranch: (ref, _cwd, branch) =>
    openMergeRequestForBranch(ref, branch).catch(() => null),
  snapshot: fetchMrSnapshot,
  failedLog: gitlabJobLogExcerpt,
};

export function codeHost(kind: CodeHostKind): CodeHost {
  return kind === "gitlab" ? gitlabHost : githubHost;
}
