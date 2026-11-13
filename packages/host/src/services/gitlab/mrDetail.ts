/** One GitLab merge request's detail and diff, in the pull-request shapes the clients read. */

import type { JobNode } from "./jobs";
import type { RepoRef } from "../codeHost/remoteUrl";
import type {
  PullRequestComment,
  PullRequestCommit,
  PullRequestDetail,
} from "../github/prDetail";
import { absoluteUrl, glabGraphql, glabRestAll, projectApiPath } from "./glab";
import { JOB_FIELDS, jobCheck } from "./jobs";

interface Person {
  avatarUrl?: string | null;
  username?: string;
}

export interface NoteNode {
  author?: Person | null;
  body: string;
  bodyHtml?: string | null;
  createdAt?: string;
  id: string;
  position?: {
    filePath?: string | null;
    newLine?: number | null;
    oldLine?: number | null;
  } | null;
  system: boolean;
  url?: string | null;
}

interface CommitNode {
  author?: Person | null;
  authorName?: string | null;
  authoredDate?: string | null;
  message?: string | null;
  sha: string;
  shortId: string;
  webUrl?: string | null;
}

export interface MrDetailNode {
  author: Person | null;
  commitCount?: number | null;
  commits?: { nodes: CommitNode[] } | null;
  conflicts: boolean;
  createdAt: string;
  description?: string | null;
  descriptionHtml?: string | null;
  detailedMergeStatus?: string | null;
  diffStats?: { additions: number; deletions: number; path: string }[] | null;
  diffStatsSummary?: {
    additions: number;
    deletions: number;
    fileCount: number;
  } | null;
  draft: boolean;
  headPipeline?: { jobs?: { nodes: JobNode[] } | null; status?: string } | null;
  iid: string;
  labels?: { nodes: { title: string }[] } | null;
  notes?: { nodes: NoteNode[] } | null;
  sourceBranch: string;
  state: string;
  targetBranch: string;
  title: string;
  updatedAt: string;
  webUrl: string;
}

const QUERY = `query($path: ID!, $iid: String!) {
  project(fullPath: $path) {
    fullPath webUrl
    mergeRequest(iid: $iid) {
      iid title webUrl state draft createdAt updatedAt
      description descriptionHtml
      sourceBranch targetBranch conflicts detailedMergeStatus
      author { username avatarUrl }
      labels(first: 30) { nodes { title } }
      diffStatsSummary { additions deletions fileCount }
      diffStats { path additions deletions }
      commitCount
      commits(first: 100) { nodes { sha shortId message authoredDate webUrl authorName author { username avatarUrl } } }
      headPipeline { status jobs(first: 100) { nodes { ${JOB_FIELDS} } } }
      notes(last: 100) { nodes { id body bodyHtml createdAt url system author { username avatarUrl } position { filePath newLine oldLine } } }
    }
  }
}`;

/** `opened` → `OPEN`, and so on; a locked MR is closed to discussion. */
export function mrState(state: string): "CLOSED" | "MERGED" | "OPEN" {
  if (state === "merged") {
    return "MERGED";
  }

  return state === "opened" ? "OPEN" : "CLOSED";
}

export function mrMergeable(
  node: Pick<MrDetailNode, "conflicts" | "detailedMergeStatus">,
): "CONFLICTING" | "MERGEABLE" | "UNKNOWN" {
  if (node.conflicts) {
    return "CONFLICTING";
  }

  return node.detailedMergeStatus?.toUpperCase() === "MERGEABLE"
    ? "MERGEABLE"
    : "UNKNOWN";
}

function noteLocation(note: NoteNode): string | undefined {
  const p = note.position;
  if (!p?.filePath) {
    return undefined;
  }
  const line = p.newLine ?? p.oldLine;

  return `${p.filePath}${line ? `:${line}` : ""}`;
}

/** People's notes, oldest first: a diff note is a one-comment review, the rest are comments. */
export function mapNotes(
  host: string,
  notes: NoteNode[],
): PullRequestComment[] {
  return notes
    .filter((n) => !n.system)
    .map((n): PullRequestComment => {
      const base = {
        id: n.id,
        author: n.author?.username ?? null,
        authorAvatarUrl: absoluteUrl(host, n.author?.avatarUrl),
        createdAt: n.createdAt ?? "",
        url: n.url ?? "",
      };
      const location = noteLocation(n);
      if (!location) {
        return {
          ...base,
          kind: "issue",
          body: n.body,
          bodyHtml: n.bodyHtml ?? "",
        };
      }

      return {
        ...base,
        kind: "review",
        body: "",
        bodyHtml: "",
        reviewState: "COMMENTED",
        inlineComments: [
          {
            id: n.id,
            body: `${location}\n\n${n.body}`,
            bodyHtml: n.bodyHtml ?? "",
            createdAt: n.createdAt ?? "",
            url: n.url ?? "",
          },
        ],
      };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

export function toPullRequestDetail(
  host: string,
  project: { fullPath: string; webUrl: string },
  mr: MrDetailNode,
): PullRequestDetail {
  const state = mrState(mr.state);
  const pipelineStatus = mr.headPipeline?.status?.toLowerCase() ?? null;
  const commitList: PullRequestCommit[] = (mr.commits?.nodes ?? []).map(
    (c, i) => ({
      oid: c.sha,
      abbreviatedOid: c.shortId,
      message: c.message ?? "",
      committedDate: c.authoredDate ?? "",
      url: c.webUrl ?? "",
      author: c.author?.username ?? c.authorName ?? null,
      authorAvatarUrl: absoluteUrl(host, c.author?.avatarUrl),
      // GitLab lists newest first; only the head has a pipeline to speak of.
      statusRollup: i === 0 ? pipelineStatus : null,
    }),
  );
  const files = (mr.diffStats ?? []).map((f) => ({
    path: f.path,
    additions: f.additions,
    deletions: f.deletions,
    changeType: "MODIFIED",
  }));

  return {
    number: Number(mr.iid),
    title: mr.title,
    url: mr.webUrl,
    state,
    isDraft: mr.draft,
    merged: state === "MERGED",
    mergeable: mrMergeable(mr),
    createdAt: mr.createdAt,
    updatedAt: mr.updatedAt,
    additions: mr.diffStatsSummary?.additions ?? 0,
    deletions: mr.diffStatsSummary?.deletions ?? 0,
    changedFiles: mr.diffStatsSummary?.fileCount ?? files.length,
    commits: mr.commitCount ?? commitList.length,
    commitList,
    headRefName: mr.sourceBranch,
    baseRefName: mr.targetBranch,
    body: mr.description ?? "",
    bodyHtml: mr.descriptionHtml ?? "",
    author: mr.author?.username ?? null,
    authorAvatarUrl: absoluteUrl(host, mr.author?.avatarUrl),
    repoNameWithOwner: project.fullPath,
    repoUrl: project.webUrl,
    labels: (mr.labels?.nodes ?? []).map((l) => l.title),
    files,
    checks: (mr.headPipeline?.jobs?.nodes ?? []).map((j) => jobCheck(host, j)),
    comments: mapNotes(host, mr.notes?.nodes ?? []),
  };
}

export async function getMergeRequestDetail(
  ref: RepoRef,
  number: number,
): Promise<PullRequestDetail> {
  const data = await glabGraphql<{
    project: {
      fullPath: string;
      mergeRequest: MrDetailNode | null;
      webUrl: string;
    } | null;
  }>(ref.host, QUERY, { path: ref.path, iid: String(number) });
  const mr = data.project?.mergeRequest;
  if (!data.project || !mr) {
    throw `Merge request ${ref.path}!${number} not found`;
  }

  return toPullRequestDetail(ref.host, data.project, mr);
}

export interface DiffEntry {
  deleted_file: boolean;
  diff: string;
  new_file: boolean;
  new_path: string;
  old_path: string;
}

/** GitLab's per-file hunks put back together as one `git diff`. */
export function unifiedDiff(entries: DiffEntry[]): string {
  return entries
    .map((e) => {
      const header = [`diff --git a/${e.old_path} b/${e.new_path}`];
      if (e.new_file) {
        header.push("new file mode 100644");
      } else if (e.deleted_file) {
        header.push("deleted file mode 100644");
      } else if (e.old_path !== e.new_path) {
        header.push(`rename from ${e.old_path}`, `rename to ${e.new_path}`);
      }
      if (e.diff) {
        header.push(
          `--- ${e.new_file ? "/dev/null" : `a/${e.old_path}`}`,
          `+++ ${e.deleted_file ? "/dev/null" : `b/${e.new_path}`}`,
        );
      }
      const body = e.diff.endsWith("\n") || !e.diff ? e.diff : `${e.diff}\n`;

      return `${header.join("\n")}\n${body}`;
    })
    .join("");
}

export async function getMergeRequestDiff(
  ref: RepoRef,
  number: number,
): Promise<string> {
  return unifiedDiff(
    await glabRestAll<DiffEntry>(
      ref.host,
      `${projectApiPath(ref.path)}/merge_requests/${number}/diffs`,
    ),
  );
}
