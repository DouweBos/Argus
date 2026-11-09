/**
 * One lean GraphQL poll of a watched pull request — head checks with their
 * failure annotations, comments and reviews, mergeability — plus the tail of
 * a failing Actions job's log.
 */

import type {
  CheckBucket,
  PrSnapshot,
  WatchedCheck,
  WatchedComment,
} from "./snapshot";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    viewer { login }
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        number url state mergeable headRefOid
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                contexts(first: 100) {
                  nodes {
                    __typename
                    ... on CheckRun {
                      name status conclusion detailsUrl
                      isRequired(pullRequestNumber: $number)
                      annotations(first: 20) {
                        nodes { path message annotationLevel location { start { line } } }
                      }
                    }
                    ... on StatusContext {
                      context state targetUrl
                      isRequired(pullRequestNumber: $number)
                    }
                  }
                }
              }
            }
          }
        }
        timelineItems(last: 50, itemTypes: [ISSUE_COMMENT, PULL_REQUEST_REVIEW]) {
          nodes {
            __typename
            ... on IssueComment { id url body author { login } }
            ... on PullRequestReview {
              id url body state author { login }
              comments(first: 50) {
                nodes { id url body path line originalLine author { login } }
              }
            }
          }
        }
      }
    }
  }
`;

interface RawAnnotation {
  annotationLevel?: string;
  location?: { start?: { line?: number } };
  message?: string;
  path?: string;
}

export interface RawContext {
  __typename: string;
  annotations?: { nodes: RawAnnotation[] };
  conclusion?: string | null;
  context?: string;
  detailsUrl?: string | null;
  isRequired?: boolean;
  name?: string;
  state?: string | null;
  status?: string | null;
  targetUrl?: string | null;
}

interface RawAuthor {
  login?: string;
}

export interface RawTimelineNode {
  __typename: string;
  author?: RawAuthor | null;
  body?: string;
  comments?: {
    nodes: {
      author?: RawAuthor | null;
      body: string;
      id: string;
      line?: number | null;
      originalLine?: number | null;
      path?: string;
      url: string;
    }[];
  };
  id?: string;
  state?: string;
  url?: string;
}

export interface RawPullRequest {
  commits: {
    nodes: {
      commit: {
        statusCheckRollup: { contexts: { nodes: RawContext[] } } | null;
      };
    }[];
  };
  headRefOid: string;
  mergeable: string;
  number: number;
  state: string;
  timelineItems: { nodes: RawTimelineNode[] };
  url: string;
}

/** Cancelled runs are usually superseded by a newer push, not broken. */
const FAILING = new Set([
  "action_required",
  "failure",
  "startup_failure",
  "timed_out",
]);

function checkRunBucket(status: string, conclusion: string): CheckBucket {
  if (status !== "completed") {
    return "pending";
  }
  if (FAILING.has(conclusion)) {
    return "fail";
  }
  if (conclusion === "success") {
    return "pass";
  }

  return "skip";
}

function statusBucket(state: string): CheckBucket {
  if (state === "success") {
    return "pass";
  }
  if (state === "failure" || state === "error") {
    return "fail";
  }

  return "pending";
}

export function mapCheck(node: RawContext): WatchedCheck | null {
  if (node.__typename === "CheckRun") {
    return {
      name: node.name ?? "check",
      bucket: checkRunBucket(
        node.status?.toLowerCase() ?? "",
        node.conclusion?.toLowerCase() ?? "",
      ),
      required: node.isRequired === true,
      detailsUrl: node.detailsUrl ?? null,
      failures: (node.annotations?.nodes ?? [])
        .filter((a) => a.annotationLevel === "FAILURE" && a.message)
        .map((a) => {
          const line = a.location?.start?.line;
          const where = a.path ? `${a.path}${line ? `:${line}` : ""} ` : "";

          return `${where}${a.message!.trim().replace(/\n+/g, "\n  ")}`;
        }),
    };
  }
  if (node.__typename === "StatusContext") {
    return {
      name: node.context ?? "status",
      bucket: statusBucket(node.state?.toLowerCase() ?? ""),
      required: node.isRequired === true,
      detailsUrl: node.targetUrl ?? null,
      failures: [],
    };
  }

  return null;
}

export function mapTimeline(nodes: RawTimelineNode[]): WatchedComment[] {
  const out: WatchedComment[] = [];
  for (const node of nodes) {
    if (!node.id || !node.url) {
      continue;
    }
    if (node.__typename === "IssueComment") {
      out.push({
        id: node.id,
        kind: "comment",
        author: node.author?.login ?? null,
        body: node.body ?? "",
        url: node.url,
      });
    } else if (node.__typename === "PullRequestReview") {
      out.push({
        id: node.id,
        kind: "review",
        author: node.author?.login ?? null,
        body: node.body ?? "",
        url: node.url,
        reviewState: node.state,
      });
      for (const c of node.comments?.nodes ?? []) {
        const line = c.line ?? c.originalLine;
        out.push({
          id: c.id,
          kind: "inline",
          author: c.author?.login ?? null,
          body: c.body,
          url: c.url,
          location: c.path ? `${c.path}${line ? `:${line}` : ""}` : undefined,
        });
      }
    }
  }

  return out;
}

export function toSnapshot(
  pr: RawPullRequest,
  viewer: string | null,
): PrSnapshot {
  const contexts =
    pr.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? [];
  let state: PrSnapshot["state"] = "OPEN";
  if (pr.state === "MERGED" || pr.state === "CLOSED") {
    state = pr.state;
  }
  let mergeable: PrSnapshot["mergeable"] = "UNKNOWN";
  if (pr.mergeable === "MERGEABLE" || pr.mergeable === "CONFLICTING") {
    mergeable = pr.mergeable;
  }

  return {
    number: pr.number,
    url: pr.url,
    state,
    mergeable,
    headOid: pr.headRefOid,
    viewer,
    checks: contexts.map(mapCheck).filter((c): c is WatchedCheck => c !== null),
    comments: mapTimeline(pr.timelineItems.nodes),
  };
}

export async function fetchPrSnapshot(
  owner: string,
  repo: string,
  number: number,
): Promise<PrSnapshot> {
  const { stdout } = await execFileAsync(
    "gh",
    [
      "api",
      "graphql",
      "-f",
      `query=${QUERY}`,
      "-f",
      `owner=${owner}`,
      "-f",
      `repo=${repo}`,
      "-F",
      `number=${number}`,
    ],
    { maxBuffer: 10 * 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout) as {
    data?: {
      repository?: { pullRequest?: RawPullRequest | null } | null;
      viewer?: { login?: string } | null;
    };
  };
  const pr = parsed.data?.repository?.pullRequest;
  if (!pr) {
    throw `Pull request ${owner}/${repo}#${number} not found`;
  }

  return toSnapshot(pr, parsed.data?.viewer?.login ?? null);
}

const LOG_LINES = 60;
const LOG_CHARS = 6_000;
const JOB_URL = /github\.com\/([^/]+)\/([^/]+)\/actions\/runs\/\d+\/job\/(\d+)/;
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z ?/;

/** `job\tstep\t<timestamp> text` lines from `gh run view --log-failed`, as text. */
export function trimFailedLog(raw: string): string {
  const lines = raw
    .split("\n")
    .map((line) => {
      const parts = line.split("\t");

      return (parts.length >= 3 ? parts.slice(2).join("\t") : line)
        .replace(ANSI, "")
        .replace(TIMESTAMP, "")
        .trimEnd();
    })
    .filter((line) => line.length > 0);
  const tail = lines.slice(-LOG_LINES).join("\n");

  return tail.length > LOG_CHARS ? `…${tail.slice(-LOG_CHARS)}` : tail;
}

/** The tail of a GitHub Actions job's failed steps; null for anything else. */
export async function failedLogExcerpt(
  detailsUrl: string | null,
): Promise<string | null> {
  const match = detailsUrl ? JOB_URL.exec(detailsUrl) : null;
  if (!match) {
    return null;
  }
  const [, owner, repo, jobId] = match;
  try {
    const { stdout } = await execFileAsync(
      "gh",
      [
        "run",
        "view",
        "--job",
        jobId!,
        "--log-failed",
        "-R",
        `${owner}/${repo}`,
      ],
      { maxBuffer: 50 * 1024 * 1024 },
    );
    const excerpt = trimFailedLog(stdout);

    return excerpt.length > 0 ? excerpt : null;
  } catch {
    // Expired or still-uploading logs: the annotations and link still help.
    return null;
  }
}
