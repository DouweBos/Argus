/** One poll of a watched GitLab merge request, as the watcher's snapshot. */

import type { JobNode } from "./jobs";
import type { NoteNode } from "./mrDetail";
import type { RepoRef } from "../codeHost/remoteUrl";
import type { PrSnapshot, WatchedComment } from "../github/prWatch/snapshot";
import { glabGraphql } from "./glab";
import { JOB_FIELDS, jobsClean, watchedJob } from "./jobs";
import { mrMergeable, mrState } from "./mrDetail";

const QUERY = `query($path: ID!, $iid: String!) {
  currentUser { username }
  project(fullPath: $path) {
    mergeRequest(iid: $iid) {
      iid webUrl state conflicts detailedMergeStatus diffHeadSha
      headPipeline { jobs(first: 100) { nodes { ${JOB_FIELDS} } } }
      notes(last: 50) { nodes { id body url system author { username } position { filePath newLine oldLine } } }
    }
  }
}`;

export interface WatchMrNode {
  conflicts: boolean;
  detailedMergeStatus?: string | null;
  diffHeadSha?: string | null;
  headPipeline?: { jobs?: { nodes: JobNode[] } | null } | null;
  iid: string;
  notes?: { nodes: NoteNode[] } | null;
  state: string;
  webUrl: string;
}

export function mapWatchNotes(notes: NoteNode[]): WatchedComment[] {
  return notes
    .filter((n) => !n.system && n.url)
    .map((n) => {
      const p = n.position;
      const line = p?.newLine ?? p?.oldLine;

      return {
        id: n.id,
        kind: p?.filePath ? "inline" : "comment",
        author: n.author?.username ?? null,
        body: n.body,
        url: n.url!,
        location: p?.filePath
          ? `${p.filePath}${line ? `:${line}` : ""}`
          : undefined,
      };
    });
}

export function toMrSnapshot(
  host: string,
  mr: WatchMrNode,
  viewer: string | null,
): PrSnapshot {
  return {
    number: Number(mr.iid),
    url: mr.webUrl,
    state: mrState(mr.state),
    mergeable: mrMergeable(mr),
    headOid: mr.diffHeadSha ?? "",
    viewer,
    checks: (mr.headPipeline?.jobs?.nodes ?? []).map((j) =>
      watchedJob(host, j),
    ),
    comments: mapWatchNotes(mr.notes?.nodes ?? []),
  };
}

export async function fetchMrSnapshot(
  ref: RepoRef,
  number: number,
): Promise<PrSnapshot> {
  const data = await glabGraphql<{
    currentUser?: { username?: string } | null;
    project?: { mergeRequest?: WatchMrNode | null } | null;
  }>(ref.host, QUERY, { path: ref.path, iid: String(number) });
  const mr = data.project?.mergeRequest;
  if (!mr) {
    throw `Merge request ${ref.path}!${number} not found`;
  }

  return toMrSnapshot(ref.host, mr, data.currentUser?.username ?? null);
}

/** Whether the open MR from `branch` has a green pipeline; null when unknowable. */
export async function gitlabBranchChecksClean(
  ref: RepoRef,
  branch: string,
): Promise<boolean | null> {
  const query = `query($path: ID!, $branch: String!) {
    project(fullPath: $path) {
      mergeRequests(sourceBranches: [$branch], state: opened, first: 1) {
        nodes { headPipeline { jobs(first: 100) { nodes { ${JOB_FIELDS} } } } }
      }
    }
  }`;
  try {
    const data = await glabGraphql<{
      project?: {
        mergeRequests?: {
          nodes: { headPipeline?: { jobs?: { nodes: JobNode[] } } | null }[];
        };
      } | null;
    }>(ref.host, query, { path: ref.path, branch });
    const mr = data.project?.mergeRequests?.nodes[0];

    return mr ? jobsClean(ref.host, mr.headPipeline?.jobs?.nodes ?? []) : null;
  } catch {
    return null;
  }
}
