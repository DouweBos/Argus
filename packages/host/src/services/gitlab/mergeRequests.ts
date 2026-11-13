/**
 * GitLab merge requests as Argus's pull-request shapes: each session's MR
 * for the sidebar icon, and the MRs of interest for the Pull Requests list.
 */

import type { RepoRef } from "../codeHost/remoteUrl";
import type {
  InterestingPullRequest,
  PullRequestReason,
} from "../github/pullRequests";
import type { SessionPullRequest } from "../session/models";
import { absoluteUrl, glabGraphql, gqlString } from "./glab";

/** Projects per query; each takes all of its branches in one field. */
const PROJECTS_PER_QUERY = 20;

export interface BranchMrNode {
  createdAt: string;
  draft: boolean;
  iid: string;
  sourceBranch: string;
  sourceProject: { fullPath: string } | null;
  state: "closed" | "locked" | "merged" | "opened";
  webUrl: string;
}

export function toSessionMergeRequest(node: BranchMrNode): SessionPullRequest {
  let state: SessionPullRequest["state"] = "closed";
  if (node.state === "merged") {
    state = "merged";
  } else if (node.state === "opened") {
    state = node.draft ? "draft" : "open";
  }

  return { number: Number(node.iid), state, url: node.webUrl };
}

/**
 * The newest MR for `branch` whose source is one of the project's own repos —
 * a fork's same-named branch is someone else's work.
 */
export function pickMergeRequest(
  nodes: BranchMrNode[],
  branch: string,
  ownPaths: string[],
): SessionPullRequest | null {
  const own = new Set(ownPaths.map((p) => p.toLowerCase()));
  const newest = nodes
    .filter(
      (n) =>
        n.sourceBranch === branch &&
        n.sourceProject !== null &&
        own.has(n.sourceProject.fullPath.toLowerCase()),
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];

  return newest ? toSessionMergeRequest(newest) : null;
}

export function buildBranchQuery(
  projects: { branches: string[]; path: string }[],
): string {
  const fields = projects.map(
    (p, i) =>
      `p${i}: project(fullPath: ${gqlString(p.path)}) { mergeRequests(sourceBranches: [${p.branches.map(gqlString).join(", ")}], sort: CREATED_DESC, first: 100) { nodes { iid webUrl state draft createdAt sourceBranch sourceProject { fullPath } } } }`,
  );

  return `query { ${fields.join(" ")} }`;
}

/**
 * Every MR whose source branch is one of `branches`, per project on one host.
 * Keyed by lowercased project path.
 */
export async function mergeRequestsForBranches(
  host: string,
  projects: { branches: string[]; path: string }[],
): Promise<Map<string, BranchMrNode[]>> {
  const out = new Map<string, BranchMrNode[]>();
  for (let i = 0; i < projects.length; i += PROJECTS_PER_QUERY) {
    const chunk = projects.slice(i, i + PROJECTS_PER_QUERY);
    const data = await glabGraphql<
      Record<string, { mergeRequests?: { nodes: BranchMrNode[] } } | null>
    >(host, buildBranchQuery(chunk));
    chunk.forEach((p, j) => {
      // A project the user can't read comes back null; it has no MRs to show.
      out.set(p.path.toLowerCase(), data[`p${j}`]?.mergeRequests?.nodes ?? []);
    });
  }

  return out;
}

/** The session MR for each `(refs, branch)` target, null when there is none. */
export async function lookupSessionMergeRequests(
  targets: { branch: string; refs: RepoRef[] }[],
): Promise<(SessionPullRequest | null)[]> {
  const byHost = new Map<string, Map<string, Set<string>>>();
  for (const { branch, refs } of targets) {
    for (const ref of refs) {
      const projects = byHost.get(ref.host) ?? new Map<string, Set<string>>();
      byHost.set(ref.host, projects);
      const branches = projects.get(ref.path) ?? new Set<string>();
      projects.set(ref.path, branches);
      branches.add(branch);
    }
  }
  const nodes = new Map<string, BranchMrNode[]>();
  for (const [host, projects] of byHost) {
    const found = await mergeRequestsForBranches(
      host,
      [...projects].map(([path, branches]) => ({
        path,
        branches: [...branches],
      })),
    );
    for (const [path, list] of found) {
      nodes.set(`${host}\0${path}`, list);
    }
  }

  return targets.map(({ branch, refs }) =>
    pickMergeRequest(
      refs.flatMap(
        (r) => nodes.get(`${r.host}\0${r.path.toLowerCase()}`) ?? [],
      ),
      branch,
      refs.map((r) => r.path),
    ),
  );
}

interface ListMrNode {
  approvedBy?: { nodes: { username: string }[] } | null;
  author: { avatarUrl?: string | null; username?: string } | null;
  createdAt: string;
  draft: boolean;
  iid: string;
  project: { fullPath: string; webUrl: string };
  sourceBranch: string;
  targetBranch: string;
  title: string;
  updatedAt: string;
  webUrl: string;
}

const LIST_FIELDS =
  "iid title webUrl draft createdAt updatedAt sourceBranch targetBranch author { username avatarUrl } project { fullPath webUrl } approvedBy { nodes { username } }";

const LIST_QUERY = `query {
  currentUser {
    username
    authored: authoredMergeRequests(state: opened, first: 100) { nodes { ${LIST_FIELDS} } }
    reviewing: reviewRequestedMergeRequests(state: opened, first: 100) { nodes { ${LIST_FIELDS} } }
    assigned: assignedMergeRequests(state: opened, first: 100) { nodes { ${LIST_FIELDS} } }
  }
}`;

interface ListResult {
  currentUser: {
    assigned?: { nodes: ListMrNode[] };
    authored?: { nodes: ListMrNode[] };
    reviewing?: { nodes: ListMrNode[] };
    username: string;
  } | null;
}

export function toInterestingMergeRequest(
  host: string,
  node: ListMrNode,
  reasons: PullRequestReason[],
  repoRoot: string,
): InterestingPullRequest {
  return {
    number: Number(node.iid),
    title: node.title,
    url: node.webUrl,
    isDraft: node.draft,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    reviewDecision:
      (node.approvedBy?.nodes.length ?? 0) > 0 ? "APPROVED" : null,
    author: node.author?.username ?? null,
    authorAvatarUrl: absoluteUrl(host, node.author?.avatarUrl),
    repoNameWithOwner: node.project.fullPath,
    repoUrl: node.project.webUrl,
    headRefName: node.sourceBranch,
    baseRefName: node.targetBranch,
    repoRoot,
    reasons: [...reasons].sort(),
  };
}

/** Open MRs the signed-in user wrote, reviews, or is assigned, on one host. */
export async function listInterestingMergeRequests(
  host: string,
  pathToRoot: Map<string, string>,
): Promise<InterestingPullRequest[]> {
  const data = await glabGraphql<ListResult>(host, LIST_QUERY);
  const user = data.currentUser;
  if (!user) {
    return [];
  }
  const byUrl = new Map<
    string,
    { node: ListMrNode; reasons: Set<PullRequestReason> }
  >();
  const add = (nodes: ListMrNode[] | undefined, reason: PullRequestReason) => {
    for (const node of nodes ?? []) {
      if (!pathToRoot.has(node.project.fullPath.toLowerCase())) {
        continue;
      }
      const hit = byUrl.get(node.webUrl);
      if (hit) {
        hit.reasons.add(reason);
      } else {
        byUrl.set(node.webUrl, { node, reasons: new Set([reason]) });
      }
    }
  };
  add(user.authored?.nodes, "author");
  add(user.reviewing?.nodes, "reviewer");
  add(user.assigned?.nodes, "commenter");

  return [...byUrl.values()].map(({ node, reasons }) => {
    if (reasons.has("author")) {
      reasons.delete("commenter");
    }

    return toInterestingMergeRequest(
      host,
      node,
      [...reasons],
      pathToRoot.get(node.project.fullPath.toLowerCase())!,
    );
  });
}

/** The newest open MR from `branch` in `ref`, for watching one Argus hasn't seen yet. */
export async function openMergeRequestForBranch(
  ref: RepoRef,
  branch: string,
): Promise<{ number: number; url: string } | null> {
  const found = await mergeRequestsForBranches(ref.host, [
    { path: ref.path, branches: [branch] },
  ]);
  const open = (found.get(ref.path.toLowerCase()) ?? []).find(
    (n) => n.state === "opened" && n.sourceBranch === branch,
  );

  return open ? { number: Number(open.iid), url: open.webUrl } : null;
}
