/**
 * How the Issues screen lays Linear issues out: a column per workflow state,
 * a swimlane per priority, and which Argus session (if any) is on an issue.
 */

import type { LinearIssue, Session } from "./types";

/** Linear's state categories in the order work flows through them. */
const TYPE_ORDER = [
  "triage",
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
];

/** Urgent first, "no priority" last — Linear's own order. */
export const PRIORITY_ORDER = [1, 2, 3, 4, 0];

export interface BoardColumn {
  id: string;
  issues: LinearIssue[];
  name: string;
  type: string;
}

function typeRank(type: string): number {
  const rank = TYPE_ORDER.indexOf(type);

  return rank === -1 ? TYPE_ORDER.length : rank;
}

/**
 * One column per state the issues are in. Teams name states differently, so
 * same-named states across teams share a column.
 */
export function boardColumns(issues: LinearIssue[]): BoardColumn[] {
  const columns = new Map<string, BoardColumn & { rank: number[] }>();
  for (const issue of issues) {
    const key = issue.state.name.toLowerCase();
    const column = columns.get(key) ?? {
      id: key,
      name: issue.state.name,
      type: issue.state.type,
      issues: [],
      rank: [typeRank(issue.state.type), issue.state.position],
    };
    column.issues.push(issue);
    columns.set(key, column);
  }

  return [...columns.values()]
    .sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1])
    .map(({ rank: _rank, ...column }) => column);
}

/** Most urgent first, then most recently touched. */
export function byPriority(a: LinearIssue, b: LinearIssue): number {
  return (
    PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) ||
    b.updatedAt - a.updatedAt
  );
}

/** The session already working on the issue, if any. */
export function sessionForIssue(
  issue: Pick<LinearIssue, "branchName" | "identifier">,
  sessions: Session[],
): Session | null {
  return (
    sessions.find(
      (s) =>
        s.linked_issue?.identifier === issue.identifier ||
        (s.kind === "worktree" && s.branch === issue.branchName),
    ) ?? null
  );
}

export function cycleLabel(cycle: LinearIssue["cycle"]): string | null {
  if (!cycle) {
    return null;
  }

  return cycle.name ? cycle.name : `Cycle ${cycle.number}`;
}

const DATE = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function formatIssueDate(epochMs: number): string {
  return DATE.format(new Date(epochMs));
}
