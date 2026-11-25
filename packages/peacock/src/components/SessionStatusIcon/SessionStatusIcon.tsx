import { IssueStatusIcon } from "../IssueStatusIcon/IssueStatusIcon";

/** Where a session's work stands, as the host sends it. */
export type SessionWorkflowStatus =
  | "done"
  | "in_progress"
  | "in_review"
  | "todo";

export const SESSION_WORKFLOW_STATUSES: SessionWorkflowStatus[] = [
  "todo",
  "in_progress",
  "in_review",
  "done",
];

export const SESSION_WORKFLOW_STATUS_LABELS: Record<
  SessionWorkflowStatus,
  string
> = {
  todo: "To do",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
};

const GLYPH: Record<SessionWorkflowStatus, string> = {
  todo: "unstarted",
  in_progress: "started",
  in_review: "review",
  done: "completed",
};

export interface SessionStatusIconProps {
  className?: string;
  size?: number;
  status: SessionWorkflowStatus;
}

/** A session's workflow status as the issue-status circle: empty, half, three quarters, checked. */
export function SessionStatusIcon({
  className,
  size = 12,
  status,
}: SessionStatusIconProps) {
  return (
    <span
      aria-label={SESSION_WORKFLOW_STATUS_LABELS[status]}
      className={className}
      role="img"
      title={SESSION_WORKFLOW_STATUS_LABELS[status]}
    >
      <IssueStatusIcon size={size} type={GLYPH[status]} />
    </span>
  );
}
