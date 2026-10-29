/**
 * How the Issues screen lays Linear issues out: a column per workflow state,
 * a swimlane per priority, and which Argus session (if any) is on an issue.
 */

import type { LinearIssue, LinearWorkflowState, Session } from "./types";

/** Linear's state categories in the order work flows through them. */
const TYPE_ORDER = [
  "triage",
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
  "duplicate",
];

/** Finished work stays out of the way even when it has issues. */
const DONE_TYPES = new Set(["canceled", "completed", "duplicate"]);

/**
 * Linear's own default: every status with open issues, not empty ones or
 * finished work. `overrides` maps a column id to an explicit hide or show.
 */
export function isColumnHidden(
  column: Pick<BoardColumn, "id" | "issues" | "type">,
  overrides: Record<string, boolean>,
): boolean {
  return (
    overrides[column.id] ??
    (column.issues.length === 0 || DONE_TYPES.has(column.type))
  );
}

/** Urgent first, "no priority" last — Linear's own order. */
export const PRIORITY_ORDER = [1, 2, 3, 4, 0];

export interface BoardColumn {
  color: string | null;
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
 * One column per state the issues are in, plus the teams' other `states`
 * (empty). Teams name states differently, so same-named states share a column.
 */
export function boardColumns(
  issues: LinearIssue[],
  states: LinearWorkflowState[] = [],
): BoardColumn[] {
  const columns = new Map<string, BoardColumn & { rank: number[] }>();
  const columnFor = (state: LinearWorkflowState) => {
    const key = state.name.toLowerCase();
    const existing = columns.get(key) ?? {
      id: key,
      name: state.name,
      type: state.type,
      color: state.color ?? null,
      issues: [],
      rank: [typeRank(state.type), state.position],
    };
    columns.set(key, existing);

    return existing;
  };
  for (const issue of issues) {
    columnFor(issue.state).issues.push(issue);
  }
  for (const state of states) {
    columnFor(state);
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

const MONTH = new Intl.DateTimeFormat(undefined, {
  month: "short",
  year: "numeric",
});

/** "Dec 2025", the way Linear dates a card. */
export function formatIssueMonth(epochMs: number): string {
  return MONTH.format(new Date(epochMs));
}
