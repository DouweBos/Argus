/** Opening, commenting on, merging and closing GitLab merge requests. */

import type { RepoRef } from "../codeHost/remoteUrl";
import type { MergeStrategy } from "../github/prActions";
import { glabRest, projectApiPath } from "./glab";

export function mrPath(ref: RepoRef, number: number): string {
  return `${projectApiPath(ref.path)}/merge_requests/${number}`;
}

/** GitLab marks drafts by title. */
export function draftTitle(title: string, draft: boolean): string {
  return draft && !/^(draft:|\[draft\]|\(draft\))/i.test(title.trim())
    ? `Draft: ${title}`
    : title;
}

export async function createMergeRequest(
  ref: RepoRef,
  params: {
    base: string;
    body: string;
    draft: boolean;
    head: string;
    title: string;
  },
): Promise<{ number: number; url: string }> {
  const mr = await glabRest<{ iid: number; web_url: string }>(
    ref.host,
    `${projectApiPath(ref.path)}/merge_requests`,
    {
      method: "POST",
      fields: {
        source_branch: params.head,
        target_branch: params.base,
        title: draftTitle(params.title, params.draft),
        description: params.body,
      },
    },
  );

  return { number: mr.iid, url: mr.web_url };
}

export async function commentOnMergeRequest(
  ref: RepoRef,
  number: number,
  body: string,
): Promise<void> {
  await glabRest(ref.host, `${mrPath(ref, number)}/notes`, {
    method: "POST",
    fields: { body },
  });
}

/**
 * GitLab sets merge-commit vs fast-forward per project, so `rebase` and
 * `merge` both take the project's method; only squashing is per merge.
 */
export async function mergeMergeRequest(
  ref: RepoRef,
  number: number,
  strategy: MergeStrategy,
): Promise<void> {
  await glabRest(ref.host, `${mrPath(ref, number)}/merge`, {
    method: "PUT",
    fields: { squash: strategy === "squash" },
  });
}

export async function closeMergeRequest(
  ref: RepoRef,
  number: number,
): Promise<void> {
  await glabRest(ref.host, mrPath(ref, number), {
    method: "PUT",
    fields: { state_event: "close" },
  });
}

/** Open issues in a project, newest first. */
export async function listGitlabIssues(
  ref: RepoRef,
): Promise<{ number: number; title: string }[]> {
  const rows = await glabRest<{ iid: number; title: string }[]>(
    ref.host,
    `${projectApiPath(ref.path)}/issues?state=opened&per_page=50`,
  );

  return rows.map((r) => ({ number: r.iid, title: r.title }));
}
