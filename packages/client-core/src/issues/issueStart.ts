/**
 * Starting agents from Linear issues: one worktree per issue on Linear's
 * branch name, with an agent the computer starts on the issue once setup
 * finishes. The twin of `HostStore.startFromIssues` in ArgusCore.
 */

import type { IssueScope } from "../routes/route";
import type { StartDraft } from "../startAgent";
import type { GatewayParams, LinearIssue } from "@argus/remote-protocol";

export type IssueStartDraft = Pick<
  StartDraft,
  "baseBranch" | "message" | "model" | "permissionMode" | "runnerId"
>;

/** `sessions.create` for one issue; anything typed goes after the issue's own context. */
export function issueSessionParams(
  issue: Pick<LinearIssue, "branchName" | "identifier">,
  draft: IssueStartDraft,
  repoRoot: string,
): GatewayParams<"sessions.create"> {
  const prompt = draft.message.trim();

  return {
    repo_root: repoRoot,
    branch: issue.branchName,
    description: issue.identifier,
    linear_issue: issue.identifier,
    ...(draft.baseBranch ? { base_branch: draft.baseBranch } : {}),
    ...(prompt ? { prompt } : {}),
    ...(draft.model ? { model: draft.model } : {}),
    ...(draft.permissionMode ? { permission_mode: draft.permissionMode } : {}),
    ...(draft.runnerId ? { runner_id: draft.runnerId } : {}),
  };
}

/** What the composer says about a start from issues. */
export function issueStartHint(count: number): string {
  return count === 1
    ? "It starts from the issue, in a worktree on Linear's branch name. Anything you add goes after it."
    : "Each starts from its issue, in a worktree on Linear's branch name. Anything you add goes after it.";
}

/**
 * The project an issue start opens on: the only one, or the one the last
 * issue went to while it's still open, as the Mac and the phone do.
 */
export function preselectedIssueProject(
  repoRoots: readonly string[],
  last: string | null,
): string | null {
  if (repoRoots.length === 1) {
    return repoRoots[0];
  }

  return repoRoots.find((r) => r === last) ?? null;
}

export const ISSUE_SCOPE_TITLES: Record<IssueScope, string> = {
  assigned: "Assigned to me",
  created: "Created by me",
  search: "Search",
  subscribed: "Subscribed",
};

/** What an empty list says. */
export function issuesEmptyText(
  scope: IssueScope,
  query: string | null,
  filtered: boolean,
): { body: string; title: string } {
  if (scope === "search") {
    return {
      title: "No issues match",
      body: query
        ? `Nothing in Linear matches “${query}”${filtered ? " with these filters" : ""}.`
        : "Type to search every issue in the workspace.",
    };
  }

  return {
    title: "No open issues here",
    body: filtered
      ? "No open issues match these filters."
      : "Open issues in this view show up here.",
  };
}

/** How many results a workspace search found, never the count itself. */
export function issueResultsBucket(
  count: number,
): "0" | "1-5" | "6-20" | "21+" {
  if (count === 0) {
    return "0";
  }
  if (count <= 5) {
    return "1-5";
  }

  return count <= 20 ? "6-20" : "21+";
}
