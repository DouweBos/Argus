/**
 * Fetch a single pull request's detail (description, files, checks, comments)
 * via `gh api graphql` in one shot. If a section is absent on the response
 * (e.g. no checks configured), the corresponding array is empty.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type CheckConclusion =
  | "action_required"
  | "cancelled"
  | "failure"
  | "neutral"
  | "skipped"
  | "stale"
  | "startup_failure"
  | "success"
  | "timed_out";

export type CheckStatus =
  | "completed"
  | "in_progress"
  | "pending"
  | "queued"
  | "requested"
  | "waiting";

export interface PullRequestFile {
  additions: number;
  changeType: string;
  deletions: number;
  path: string;
}

export interface PullRequestCommit {
  abbreviatedOid: string;
  author: string | null;
  authorAvatarUrl: string | null;
  committedDate: string;
  message: string;
  oid: string;
  statusRollup: string | null;
  url: string;
}

export interface PullRequestCheck {
  conclusion: CheckConclusion | null;
  detailsUrl: string | null;
  name: string;
  status: CheckStatus | null;
  /** Plain status-context description (populated for legacy statuses only). */
  description: string | null;
}

export interface InlineReviewComment {
  body: string;
  /** GitHub's pre-rendered HTML — includes autolinks, emoji, task lists. */
  bodyHtml: string;
  createdAt: string;
  id: string;
  url: string;
}

export interface PullRequestComment {
  author: string | null;
  authorAvatarUrl: string | null;
  body: string;
  /** GitHub's pre-rendered HTML — includes autolinks, emoji, task lists. */
  bodyHtml: string;
  createdAt: string;
  id: string;
  /** Inline review comments attached to a `kind === "review"` entry. */
  inlineComments?: InlineReviewComment[];
  kind: "issue" | "review";
  /** Review verdict for `kind === "review"` entries. */
  reviewState?: string;
  url: string;
}

export interface PullRequestDetail {
  additions: number;
  author: string | null;
  authorAvatarUrl: string | null;
  baseRefName: string;
  body: string;
  /** GitHub's pre-rendered HTML — includes autolinks, emoji, task lists. */
  bodyHtml: string;
  changedFiles: number;
  checks: PullRequestCheck[];
  comments: PullRequestComment[];
  commitList: PullRequestCommit[];
  commits: number;
  createdAt: string;
  deletions: number;
  files: PullRequestFile[];
  headRefName: string;
  isDraft: boolean;
  labels: string[];
  merged: boolean;
  mergeable: string;
  number: number;
  repoNameWithOwner: string;
  repoUrl: string;
  state: string;
  title: string;
  updatedAt: string;
  url: string;
}

interface FileNode {
  additions: number;
  changeType: string;
  deletions: number;
  path: string;
}

export interface TimelineNode {
  __typename: string;
  author?: { avatarUrl?: string; login?: string } | null;
  body?: string;
  bodyHTML?: string;
  comments?: { nodes: CommentSubNode[] };
  createdAt?: string;
  id?: string;
  state?: string;
  url?: string;
}

export interface CommentSubNode {
  author?: { avatarUrl?: string; login?: string } | null;
  body: string;
  bodyHTML: string;
  createdAt: string;
  id: string;
  url: string;
}

interface CheckNode {
  __typename: string;
  conclusion?: string | null;
  context?: string;
  description?: string | null;
  detailsUrl?: string | null;
  name?: string;
  state?: string | null;
  status?: string | null;
  targetUrl?: string | null;
}

interface PrDetailGraphQL {
  data: {
    repository: {
      pullRequest: {
        additions: number;
        author: { avatarUrl?: string; login?: string } | null;
        baseRefName: string;
        body: string;
        bodyHTML: string;
        changedFiles: number;
        commits: {
          nodes: {
            commit: {
              abbreviatedOid: string;
              author: {
                avatarUrl?: string;
                user?: { login?: string } | null;
                name?: string;
              } | null;
              committedDate: string;
              message: string;
              oid: string;
              statusCheckRollup: {
                contexts: { nodes: CheckNode[] };
                state: string;
              } | null;
              url: string;
            };
          }[];
          totalCount: number;
        };
        createdAt: string;
        deletions: number;
        files: { nodes: FileNode[] };
        headRefName: string;
        isDraft: boolean;
        labels: { nodes: { name: string }[] };
        mergeable: string;
        merged: boolean;
        number: number;
        repository: { nameWithOwner: string; url: string };
        state: string;
        timelineItems: { nodes: TimelineNode[] };
        title: string;
        updatedAt: string;
        url: string;
      };
    };
  };
}

const QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        number title url state isDraft merged mergeable
        createdAt updatedAt
        additions deletions changedFiles
        headRefName baseRefName
        body
        bodyHTML
        author { login avatarUrl }
        repository { nameWithOwner url }
        labels(first: 30) { nodes { name } }
        files(first: 100) { nodes { path additions deletions changeType } }
        commits(last: 100) {
          totalCount
          nodes {
            commit {
              oid
              abbreviatedOid
              message
              committedDate
              url
              author {
                name
                avatarUrl
                user { login }
              }
              statusCheckRollup {
                state
                contexts(first: 100) {
                  nodes {
                    __typename
                    ... on CheckRun {
                      name
                      status
                      conclusion
                      detailsUrl
                    }
                    ... on StatusContext {
                      context
                      state
                      description
                      targetUrl
                    }
                  }
                }
              }
            }
          }
        }
        timelineItems(last: 100, itemTypes: [ISSUE_COMMENT, PULL_REQUEST_REVIEW]) {
          nodes {
            __typename
            ... on IssueComment {
              id url body bodyHTML createdAt
              author { login avatarUrl }
            }
            ... on PullRequestReview {
              id url body bodyHTML state createdAt
              author { login avatarUrl }
              comments(first: 50) {
                nodes {
                  id url body bodyHTML createdAt
                  author { login avatarUrl }
                }
              }
            }
          }
        }
      }
    }
  }
`;

async function gh(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("gh", args, {
    maxBuffer: 20 * 1024 * 1024,
  });

  return stdout;
}

function mapCheck(node: CheckNode): PullRequestCheck | null {
  if (node.__typename === "CheckRun") {
    return {
      name: node.name ?? "check",
      status: (node.status?.toLowerCase() as CheckStatus | undefined) ?? null,
      conclusion:
        (node.conclusion?.toLowerCase() as CheckConclusion | undefined) ?? null,
      detailsUrl: node.detailsUrl ?? null,
      description: null,
    };
  }
  if (node.__typename === "StatusContext") {
    const state = node.state?.toLowerCase() ?? null;
    let conclusion: CheckConclusion | null = null;
    let status: CheckStatus | null = null;
    if (state === "success") {
      conclusion = "success";
      status = "completed";
    } else if (state === "failure" || state === "error") {
      conclusion = "failure";
      status = "completed";
    } else if (state === "pending") {
      status = "pending";
    }

    return {
      name: node.context ?? "status",
      status,
      conclusion,
      detailsUrl: node.targetUrl ?? null,
      description: node.description ?? null,
    };
  }

  return null;
}

export function mapComments(nodes: TimelineNode[]): PullRequestComment[] {
  const out: PullRequestComment[] = [];
  for (const node of nodes) {
    if (node.__typename === "IssueComment") {
      out.push({
        id: node.id ?? "",
        kind: "issue",
        body: node.body ?? "",
        bodyHtml: node.bodyHTML ?? "",
        createdAt: node.createdAt ?? "",
        url: node.url ?? "",
        author: node.author?.login ?? null,
        authorAvatarUrl: node.author?.avatarUrl ?? null,
      });
    } else if (node.__typename === "PullRequestReview") {
      // GitHub renders each PR review as a single timeline entry — the
      // review state (Approved / Changes requested / Reviewed) sits at the
      // top, the optional review body is in the middle, and inline thread
      // replies are grouped beneath. Mirror that shape here so the UI
      // doesn't surface a stray "Reviewed · (no body)" card next to each
      // inline comment.
      const inlineComments: InlineReviewComment[] = (
        node.comments?.nodes ?? []
      ).map((sub) => ({
        id: sub.id,
        body: sub.body,
        bodyHtml: sub.bodyHTML,
        createdAt: sub.createdAt,
        url: sub.url,
      }));
      const hasBody = (node.body ?? "").trim() !== "";
      // Suppress the empty-state COMMENTED review GitHub auto-creates when
      // you leave only inline replies. For every other state we keep the
      // entry so the state badge still renders even when the body is empty
      // (e.g. a bare "Approved").
      const isBareCommented =
        node.state === "COMMENTED" && !hasBody && inlineComments.length === 0;
      if (!isBareCommented) {
        out.push({
          id: node.id ?? "",
          kind: "review",
          body: node.body ?? "",
          bodyHtml: node.bodyHTML ?? "",
          createdAt: node.createdAt ?? "",
          url: node.url ?? "",
          author: node.author?.login ?? null,
          authorAvatarUrl: node.author?.avatarUrl ?? null,
          reviewState: node.state,
          inlineComments:
            inlineComments.length > 0 ? inlineComments : undefined,
        });
      }
    }
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

  return out;
}

/**
 * Fetch the raw unified diff for a PR — the same bytes `git diff` would
 * produce locally — via the GitHub REST API. Piped straight into the
 * shared diff parser on the renderer side.
 */
export async function getPullRequestDiff(
  owner: string,
  repo: string,
  number: number,
): Promise<string> {
  const { stdout } = await execFileAsync(
    "gh",
    [
      "api",
      `/repos/${owner}/${repo}/pulls/${number}`,
      "-H",
      "Accept: application/vnd.github.v3.diff",
    ],
    { maxBuffer: 50 * 1024 * 1024 },
  );

  return stdout;
}

export async function getPullRequestDetail(
  owner: string,
  repo: string,
  number: number,
): Promise<PullRequestDetail> {
  const stdout = await gh([
    "api",
    "graphql",
    "-f",
    `query=${QUERY}`,
    "-F",
    `owner=${owner}`,
    "-F",
    `repo=${repo}`,
    "-F",
    `number=${number}`,
  ]);
  const parsed = JSON.parse(stdout) as PrDetailGraphQL;
  const pr = parsed.data?.repository?.pullRequest;
  if (!pr) {
    throw new Error(`Pull request ${owner}/${repo}#${number} not found`);
  }

  // statusCheckRollup sits on the head commit — which is the last entry in the
  // commit list we fetched (ordered oldest → newest).
  const headCommit = pr.commits.nodes[pr.commits.nodes.length - 1]?.commit;
  const checkNodes = headCommit?.statusCheckRollup?.contexts.nodes ?? [];
  const checks = checkNodes
    .map(mapCheck)
    .filter((c): c is PullRequestCheck => c !== null);

  const commitList: PullRequestCommit[] = pr.commits.nodes
    .slice()
    .reverse()
    .map(({ commit }) => ({
      oid: commit.oid,
      abbreviatedOid: commit.abbreviatedOid,
      message: commit.message,
      committedDate: commit.committedDate,
      url: commit.url,
      author: commit.author?.user?.login ?? commit.author?.name ?? null,
      authorAvatarUrl: commit.author?.avatarUrl ?? null,
      statusRollup: commit.statusCheckRollup?.state?.toLowerCase() ?? null,
    }));

  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    state: pr.state,
    isDraft: pr.isDraft,
    merged: pr.merged,
    mergeable: pr.mergeable,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
    commits: pr.commits.totalCount,
    commitList,
    headRefName: pr.headRefName,
    baseRefName: pr.baseRefName,
    body: pr.body ?? "",
    bodyHtml: pr.bodyHTML ?? "",
    author: pr.author?.login ?? null,
    authorAvatarUrl: pr.author?.avatarUrl ?? null,
    repoNameWithOwner: pr.repository.nameWithOwner,
    repoUrl: pr.repository.url,
    labels: pr.labels.nodes.map((l) => l.name),
    files: pr.files.nodes,
    checks,
    comments: mapComments(pr.timelineItems.nodes),
  };
}
