/**
 * A session's workflow status. Port of ArgusCore's `effectiveStatus`: a set
 * status wins, else an open pull request reads as in review and a merged or
 * closed one as done.
 */

import type {
  RemoteSession,
  SessionWorkflowStatus,
} from "@argus/remote-protocol";

type Session = Pick<
  RemoteSession,
  "pull_request" | "settled" | "workflow_status"
>;

/** Set by the user or an agent; an older host's done or kept-active reads as done or in progress. */
export function setWorkflowStatus(
  session: Session,
): SessionWorkflowStatus | null {
  if (session.workflow_status) {
    return session.workflow_status;
  }
  if (session.settled === true) {
    return "done";
  }

  return session.settled === false ? "in_progress" : null;
}

export function effectiveWorkflowStatus(
  session: Session,
): SessionWorkflowStatus | null {
  const set = setWorkflowStatus(session);
  if (set) {
    return set;
  }
  const state = session.pull_request?.state;
  if (state === "merged" || state === "closed") {
    return "done";
  }

  return state ? "in_review" : null;
}
