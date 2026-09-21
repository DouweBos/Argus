/**
 * Your own open pull requests, with the two things that make one need
 * attention: red CI and review comments you have not answered.
 *
 * It is a separate source from `github` because the question is different —
 * that one asks "what should I work on", this one asks "what did I already
 * push that has since gone wrong". Both go through the same `gh` CLI and the
 * same defensive contract: a failure yields no items, never a failed run.
 */

import type { PullRequestDetail } from "../../github/prDetail";
import type { InterestingPullRequest } from "../../github/pullRequests";
import type { SignalSource, WorkItem } from "../types";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getPullRequestDetail } from "../../github/prDetail";
import { listInterestingPullRequests } from "../../github/pullRequests";
import { collectAllProjects } from "../../mcp/projectDiscovery";
import { GITHUB_PRS_SOURCE_ID } from "../sourceIds";

const execFileAsync = promisify(execFile);

/** Detail is a GraphQL round trip each, so only the freshest PRs get one. */
const MAX_DETAILED = 12;

const FAILING: string[] = [
  "action_required",
  "failure",
  "startup_failure",
  "timed_out",
];

function failingChecks(detail: PullRequestDetail): string[] {
  return detail.checks
    .filter((c) => c.conclusion && FAILING.includes(c.conclusion))
    .map((c) => c.name);
}

function pendingChecks(detail: PullRequestDetail): string[] {
  return detail.checks
    .filter((c) => c.status !== "completed")
    .map((c) => c.name);
}

/**
 * Comments written by somebody else after the PR's last commit — the ones the
 * author has demonstrably not answered with code yet.
 */
function unansweredComments(detail: PullRequestDetail): {
  author: string;
  body: string;
  url: string;
}[] {
  const lastCommit = detail.commitList.at(-1)?.committedDate;
  const since = lastCommit ? Date.parse(lastCommit) : Number.NaN;

  return detail.comments
    .filter((c) => c.author !== detail.author)
    .filter((c) => Number.isNaN(since) || Date.parse(c.createdAt) > since)
    .flatMap((c) => [
      { author: c.author ?? "someone", body: c.body, url: c.url },
      ...(c.inlineComments ?? []).map((i) => ({
        author: c.author ?? "someone",
        body: i.body,
        url: i.url,
      })),
    ])
    .filter((c) => c.body.trim().length > 0)
    .slice(0, 20);
}

function ciLine(detail: PullRequestDetail): string {
  const failing = failingChecks(detail);
  if (failing.length > 0) {
    return `CI red: ${failing.join(", ")}.`;
  }
  const pending = pendingChecks(detail);

  return pending.length > 0
    ? `CI still running: ${pending.join(", ")}.`
    : "CI green.";
}

/** The digest the run's agent reads instead of the raw GraphQL. */
function describe(
  pr: InterestingPullRequest,
  detail: PullRequestDetail | null,
): string {
  const lines = [
    `Branch \`${pr.headRefName}\` into \`${pr.baseRefName}\`${pr.isDraft ? " (draft)" : ""}.`,
    `Review decision: ${pr.reviewDecision ?? "none yet"}.`,
  ];

  if (!detail) {
    lines.push("Details could not be fetched for this PR.");

    return lines.join("\n");
  }

  lines.push(ciLine(detail));

  const comments = unansweredComments(detail);
  if (comments.length === 0) {
    lines.push("No comments since the last commit.");
  } else {
    lines.push(`${comments.length} comment(s) since the last commit:`);
    for (const c of comments) {
      lines.push(`- @${c.author}: ${c.body.trim().slice(0, 400)} (${c.url})`);
    }
  }

  lines.push(detail.body.trim().slice(0, 1000));

  return lines.filter(Boolean).join("\n");
}

function toWorkItem(
  pr: InterestingPullRequest,
  detail: PullRequestDetail | null,
): WorkItem {
  const failing = detail ? failingChecks(detail).length : 0;
  const comments = detail ? unansweredComments(detail).length : 0;

  return {
    source_id: GITHUB_PRS_SOURCE_ID,
    external_id: `${pr.repoNameWithOwner}#${pr.number}`,
    url: pr.url,
    title: pr.title,
    body: describe(pr, detail),
    state: pr.isDraft ? "draft" : "open",
    assignee: pr.author,
    // Labels carry the shepherd's whole decision, so the playbook can branch
    // on them without re-reading the digest.
    labels: [
      ...(failing > 0 ? ["ci-red"] : []),
      ...(comments > 0 ? ["unanswered-comments"] : []),
      `head:${pr.headRefName}`,
    ],
    priority: null,
    updated_at: Date.parse(pr.updatedAt) || 0,
    kind: "pull_request",
    repo_root: pr.repoRoot,
  };
}

async function repoRootsToScan(scoped: string[]): Promise<string[]> {
  const roots = new Set(scoped);
  for (const project of collectAllProjects()) {
    roots.add(project.path);
  }

  return [...roots];
}

export const githubPrsSource: SignalSource = {
  id: GITHUB_PRS_SOURCE_ID,
  label: "GitHub pull requests",
  mode: "native",

  async isAvailable() {
    try {
      await execFileAsync("gh", ["auth", "status"]);

      return true;
    } catch {
      return false;
    }
  },

  async fetchAssigned({ repoRoots }) {
    let prs: InterestingPullRequest[];
    try {
      prs = await listInterestingPullRequests(await repoRootsToScan(repoRoots));
    } catch {
      return [];
    }

    const mine = prs
      .filter((pr) => pr.reasons.includes("author"))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, MAX_DETAILED);

    return Promise.all(
      mine.map(async (pr) => {
        const [owner, repo] = pr.repoNameWithOwner.split("/");
        const detail = await getPullRequestDetail(owner, repo, pr.number).catch(
          () => null,
        );

        return toWorkItem(pr, detail);
      }),
    );
  },
};

export { GITHUB_PRS_SOURCE_ID };
