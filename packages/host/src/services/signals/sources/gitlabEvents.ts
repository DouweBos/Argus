/**
 * GitLab as a signal trigger sees it. Mentions and red pipelines come from
 * your to-do list, which GitLab already fills with exactly those; the rest
 * are the same lists `gitlab.ts` reads, plus what was opened in scope.
 */

import type { GitlabIssueRow, ReviewMrNode } from "./gitlab";
import type { SignalEvent, SignalEventKind, WorkItem } from "../types";
import { gitlabRepoRefs } from "../../codeHost/repos";
import { glabGraphql, glabRest, projectApiPath } from "../../gitlab/glab";
import { GITLAB_SOURCE_ID } from "../sourceIds";
import {
  issueWorkItem,
  projectIndex,
  REVIEW_QUERY,
  reviewWorkItem,
} from "./gitlab";

interface GitlabMrRow extends GitlabIssueRow {
  draft?: boolean;
}

interface GitlabTodo {
  id: number;
  action_name?: string;
  target_type?: string;
  target_url?: string;
  body?: string;
  author?: { username?: string };
  project?: { path_with_namespace?: string };
  target?: GitlabMrRow | null;
}

function mrWorkItem(
  row: GitlabMrRow,
  paths: Map<string, string>,
): WorkItem | null {
  const item = issueWorkItem(row, paths);

  return item
    ? {
        ...item,
        external_id: item.external_id.replace(/#(\d+)$/, "!$1"),
        kind: "pull_request",
      }
    : null;
}

function rows<T>(p: Promise<T[]>): Promise<T[]> {
  return p.catch(() => []);
}

function plain(kind: SignalEventKind, items: WorkItem[]): SignalEvent[] {
  return items.map((item) => ({
    kind,
    key: `${kind}:${item.external_id}`,
    item,
    detail: {},
  }));
}

function todoItem(
  todo: GitlabTodo,
  paths: Map<string, string>,
): WorkItem | null {
  const target = todo.target;
  if (!target) {
    return null;
  }
  const project = todo.project?.path_with_namespace;
  const row: GitlabMrRow = {
    ...target,
    references: target.references ?? {
      full: project ? `${project}#${target.iid}` : undefined,
    },
  };

  return todo.target_type === "MergeRequest"
    ? mrWorkItem(row, paths)
    : issueWorkItem(row, paths);
}

async function hostEvents(
  host: string,
  paths: Map<string, string>,
  scoped: string[],
  kinds: SignalEventKind[],
): Promise<SignalEvent[]> {
  const want = (k: SignalEventKind) => kinds.includes(k);
  const toIssues = (list: GitlabIssueRow[]) =>
    list
      .map((r) => issueWorkItem(r, paths))
      .filter((i): i is WorkItem => i !== null);
  const toMrs = (list: GitlabMrRow[]) =>
    list
      .map((r) => mrWorkItem(r, paths))
      .filter((i): i is WorkItem => i !== null);
  const inScope = (what: "issues" | "merge_requests") =>
    Promise.all(
      scoped.map((project) =>
        rows(
          glabRest<GitlabMrRow[]>(
            host,
            `${projectApiPath(project)}/${what}?state=opened&per_page=30`,
          ),
        ),
      ),
    ).then((lists) => lists.flat());

  const [newIssues, newMrs, assignedIssues, assignedMrs, reviews, todos] =
    await Promise.all([
      want("new_issue") ? inScope("issues") : [],
      want("new_pr") ? inScope("merge_requests") : [],
      want("assigned")
        ? rows(
            glabRest<GitlabIssueRow[]>(
              host,
              "issues?scope=assigned_to_me&state=opened&per_page=50",
            ),
          )
        : [],
      want("assigned")
        ? rows(
            glabRest<GitlabMrRow[]>(
              host,
              "merge_requests?scope=assigned_to_me&state=opened&per_page=50",
            ),
          )
        : [],
      want("review_requested")
        ? glabGraphql<{
            currentUser?: {
              reviewRequestedMergeRequests?: { nodes: ReviewMrNode[] };
            } | null;
          }>(host, REVIEW_QUERY).catch(() => null)
        : null,
      want("mentioned") || want("ci_failed")
        ? rows(glabRest<GitlabTodo[]>(host, "todos?state=pending&per_page=50"))
        : [],
    ]);

  const events: SignalEvent[] = [
    ...plain("new_issue", toIssues(newIssues)),
    ...plain("new_pr", toMrs(newMrs)),
    ...plain("assigned", [...toIssues(assignedIssues), ...toMrs(assignedMrs)]),
    ...plain(
      "review_requested",
      (reviews?.currentUser?.reviewRequestedMergeRequests?.nodes ?? []).map(
        (n) => reviewWorkItem(n, paths),
      ),
    ),
  ];

  for (const todo of todos) {
    const item = todoItem(todo, paths);
    if (!item) {
      continue;
    }
    const action = todo.action_name;
    if (
      want("mentioned") &&
      (action === "mentioned" || action === "directly_addressed")
    ) {
      events.push({
        kind: "mentioned",
        key: `mentioned:${item.external_id}:${todo.id}`,
        item,
        detail: {
          comment: {
            author: todo.author?.username ?? "someone",
            body: (todo.body ?? "").slice(0, 2000),
            url: todo.target_url ?? item.url,
          },
        },
      });
    } else if (want("ci_failed") && action === "build_failed") {
      events.push({
        kind: "ci_failed",
        key: `ci_failed:${item.external_id}:${todo.id}`,
        item,
        detail: {
          failing_checks: [
            { name: "pipeline", url: todo.target_url ?? item.url },
          ],
        },
      });
    }
  }

  return events;
}

export async function gitlabEvents(opts: {
  kinds: SignalEventKind[];
  repoRoots: string[];
}): Promise<SignalEvent[]> {
  const index = await projectIndex(opts.repoRoots);
  const scopedByHost = new Map<string, string[]>();
  for (const root of opts.repoRoots) {
    for (const ref of await gitlabRepoRefs(root)) {
      scopedByHost.set(ref.host, [
        ...(scopedByHost.get(ref.host) ?? []),
        ref.path,
      ]);
    }
  }
  const lists = await Promise.all(
    [...index].map(([host, paths]) =>
      hostEvents(host, paths, scopedByHost.get(host) ?? [], opts.kinds).catch(
        () => [],
      ),
    ),
  );

  return lists.flat().map((e) => ({
    ...e,
    item: { ...e.item, source_id: GITLAB_SOURCE_ID },
  }));
}
