/**
 * An issue's activity the way Linear shows it: history lines and comment
 * threads in one timeline, oldest first.
 */

import type {
  LinearComment,
  LinearHistoryEvent,
  LinearIssue,
  LinearIssueDetail,
} from "./types";
import { boardColumns, byPriority } from "./issueBoard";

const UNITS: [number, string][] = [
  [365 * 86_400_000, "y"],
  [30 * 86_400_000, "mo"],
  [7 * 86_400_000, "w"],
  [86_400_000, "d"],
  [3_600_000, "h"],
  [60_000, "m"],
];

/** "5w ago", "9mo ago" — Linear's phrasing. */
export function ago(epochMs: number, now = Date.now()): string {
  const age = Math.max(0, now - epochMs);
  for (const [size, unit] of UNITS) {
    if (age >= size) {
      return `${Math.floor(age / size)}${unit} ago`;
    }
  }

  return "just now";
}

export interface CommentThread {
  replies: LinearComment[];
  root: LinearComment;
}

export type TimelineEntry =
  | { at: number; event: LinearHistoryEvent; kind: "event"; }
  | { at: number; kind: "thread"; thread: CommentThread };

/** Comments grouped into threads; a reply whose parent is missing starts its own. */
export function commentThreads(comments: LinearComment[]): CommentThread[] {
  const ids = new Set(comments.map((c) => c.id).filter(Boolean));
  const roots = comments.filter((c) => !c.parentId || !ids.has(c.parentId));

  return roots
    .map((root) => ({
      root,
      replies: comments
        .filter((c) => c.parentId && c.parentId === root.id)
        .sort((a, b) => a.createdAt - b.createdAt),
    }))
    .sort((a, b) => a.root.createdAt - b.root.createdAt);
}

export function issueTimeline(issue: LinearIssueDetail): TimelineEntry[] {
  return [
    ...(issue.history ?? []).map((event) => ({
      kind: "event" as const,
      at: event.createdAt,
      event,
    })),
    ...commentThreads(issue.comments).map((thread) => ({
      kind: "thread" as const,
      at: thread.root.createdAt,
      thread,
    })),
  ].sort((a, b) => a.at - b.at);
}

/** The order prev/next walks: the board's columns, most urgent first in each. */
export function issueOrder(issues: LinearIssue[]): string[] {
  return boardColumns(issues).flatMap((column) =>
    [...column.issues].sort(byPriority).map((i) => i.identifier),
  );
}
