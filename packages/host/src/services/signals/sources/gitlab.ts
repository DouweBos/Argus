/**
 * GitLab as a native signal source: issues assigned to you, and merge
 * requests waiting on your review, on every GitLab instance an open project
 * lives on.
 *
 * Same contract as the GitHub source: `glab` missing or signed out yields an
 * empty list, never a throw.
 */

import type { SignalSource, WorkItem } from "../types";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gitlabRepoRefs } from "../../codeHost/repos";
import { glabGraphql, glabRest } from "../../gitlab/glab";
import { collectAllProjects } from "../../mcp/projectDiscovery";
import { GITLAB_SOURCE_ID } from "../sourceIds";

const execFileAsync = promisify(execFile);

export interface GitlabIssueRow {
  assignees?: { username?: string }[];
  iid: number;
  description?: string | null;
  labels?: string[];
  references?: { full?: string };
  state?: string;
  title?: string;
  updated_at?: string;
  web_url?: string;
}

interface ReviewMrNode {
  assignees?: { nodes: { username: string }[] } | null;
  description?: string | null;
  iid: string;
  labels?: { nodes: { title: string }[] } | null;
  project: { fullPath: string };
  title: string;
  updatedAt: string;
  webUrl: string;
}

const REVIEW_QUERY = `query {
  currentUser {
    reviewRequestedMergeRequests(state: opened, first: 50) {
      nodes { iid title description webUrl updatedAt project { fullPath } labels { nodes { title } } assignees { nodes { username } } }
    }
  }
}`;

/** Each GitLab host's projects, path → checkout, from every project Argus knows. */
async function projectIndex(
  repoRoots: string[],
): Promise<Map<string, Map<string, string>>> {
  const roots = new Set(repoRoots);
  for (const project of collectAllProjects()) {
    roots.add(project.path);
  }
  const byHost = new Map<string, Map<string, string>>();
  for (const root of roots) {
    for (const ref of await gitlabRepoRefs(root)) {
      const paths = byHost.get(ref.host) ?? new Map<string, string>();
      byHost.set(ref.host, paths);
      if (!paths.has(ref.path.toLowerCase())) {
        paths.set(ref.path.toLowerCase(), root);
      }
    }
  }

  return byHost;
}

function parseTime(value: string | undefined): number {
  const t = value ? Date.parse(value) : Number.NaN;

  return Number.isNaN(t) ? 0 : t;
}

/** `group/project#12` → `group/project`. */
function projectOfReference(full: string): string {
  return full.replace(/[#!]\d+$/, "");
}

export function issueWorkItem(
  row: GitlabIssueRow,
  paths: Map<string, string>,
): WorkItem | null {
  const ref = row.references?.full;
  if (!ref || typeof row.iid !== "number") {
    return null;
  }
  const project = projectOfReference(ref);

  return {
    source_id: GITLAB_SOURCE_ID,
    external_id: `${project}#${row.iid}`,
    url: row.web_url ?? "",
    title: row.title ?? "",
    body: row.description ?? "",
    state: row.state ?? "opened",
    assignee: row.assignees?.[0]?.username ?? null,
    labels: row.labels ?? [],
    priority: null,
    updated_at: parseTime(row.updated_at),
    kind: "issue",
    repo_root: paths.get(project.toLowerCase()) ?? null,
  };
}

export function reviewWorkItem(
  node: ReviewMrNode,
  paths: Map<string, string>,
): WorkItem {
  return {
    source_id: GITLAB_SOURCE_ID,
    external_id: `${node.project.fullPath}!${node.iid}`,
    url: node.webUrl,
    title: node.title,
    body: node.description ?? "",
    state: "opened",
    assignee: node.assignees?.nodes[0]?.username ?? null,
    labels: (node.labels?.nodes ?? []).map((l) => l.title),
    priority: null,
    updated_at: parseTime(node.updatedAt),
    kind: "pull_request",
    repo_root: paths.get(node.project.fullPath.toLowerCase()) ?? null,
  };
}

async function fetchHost(
  host: string,
  paths: Map<string, string>,
): Promise<WorkItem[]> {
  const [issues, reviews] = await Promise.all([
    glabRest<GitlabIssueRow[]>(
      host,
      "issues?scope=assigned_to_me&state=opened&per_page=50",
    ).catch(() => []),
    glabGraphql<{
      currentUser?: {
        reviewRequestedMergeRequests?: { nodes: ReviewMrNode[] };
      } | null;
    }>(host, REVIEW_QUERY).catch(() => null),
  ]);

  return [
    ...issues
      .map((row) => issueWorkItem(row, paths))
      .filter((i): i is WorkItem => i !== null),
    ...(reviews?.currentUser?.reviewRequestedMergeRequests?.nodes ?? []).map(
      (node) => reviewWorkItem(node, paths),
    ),
  ];
}

export const gitlabSource: SignalSource = {
  id: GITLAB_SOURCE_ID,
  label: "GitLab",
  mode: "native",

  async isAvailable() {
    try {
      await execFileAsync("glab", ["auth", "status"]);

      return true;
    } catch {
      return false;
    }
  },

  async fetchAssigned({ repoRoots }) {
    const index = await projectIndex(repoRoots);
    const lists = await Promise.all(
      [...index].map(([host, paths]) => fetchHost(host, paths)),
    );
    const items = new Map<string, WorkItem>();
    for (const item of lists.flat()) {
      items.set(item.external_id, item);
    }

    return [...items.values()].sort((a, b) => b.updated_at - a.updated_at);
  },
};

export { GITLAB_SOURCE_ID };
