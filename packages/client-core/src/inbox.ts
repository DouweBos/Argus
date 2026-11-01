/**
 * What the inbox is made of, grouped by what you would do about it rather
 * than by which automation produced it. Port of ArgusCore's `InboxGroups`,
 * over the fields the catalog's and the gateway's proposals and runs share.
 */

import type {
  RemoteAutomationRunStatus,
  RemoteProposalStatus,
} from "@argus/remote-protocol";

/** A failure or a cleared proposal older than this is history, not an inbox item. */
export const INBOX_WINDOW_MS = 24 * 60 * 60 * 1000;
export const INBOX_MAX_FAILED_RUNS = 5;

export interface InboxProposalLike {
  status: RemoteProposalStatus;
  session_id: string | null;
  cleared_at?: number | null;
}

export interface InboxRunLike {
  status: RemoteAutomationRunStatus;
  started_at: number;
}

/** How a run's read state is read: the two wire shapes say it differently. */
export interface InboxRunReader<Run> {
  /** Opened or dismissed; a failure read this way leaves the inbox. */
  isRead: (run: Run) => boolean;
  hasUnreadReport: (run: Run) => boolean;
}

export interface InboxGroups<Proposal, Run> {
  /** Decisions waiting on you. */
  pending: Proposal[];
  /** Finished runs whose report nobody has opened yet. */
  reports: Run[];
  /** Work Argus already started, whose session still exists. */
  started: Proposal[];
  /** Recent failures nobody dismissed — the automation needs a look. */
  failed: Run[];
  /** Taken off your hands by a later run, for information. */
  cleared: Proposal[];
}

export function proposalPhase(
  status: RemoteProposalStatus,
): "cleared" | "decided" | "pending" | "started" {
  switch (status) {
    case "pending":
      return "pending";
    case "accepted":
    case "auto_started":
      return "started";
    case "superseded":
    case "withdrawn":
      return "cleared";
    default:
      return "decided";
  }
}

export function inboxGroups<
  Proposal extends InboxProposalLike,
  Run extends InboxRunLike,
>(input: {
  proposals: Proposal[];
  runs: Run[];
  reader: InboxRunReader<Run>;
  sessionIds: ReadonlySet<string>;
  /** Milliseconds, like every host timestamp. */
  now: number;
}): InboxGroups<Proposal, Run> {
  const { proposals, runs, reader, sessionIds, now } = input;
  const failed = runs
    .filter(
      (r) =>
        r.status === "failed" &&
        !reader.isRead(r) &&
        now - r.started_at < INBOX_WINDOW_MS,
    )
    .slice(0, INBOX_MAX_FAILED_RUNS);

  return {
    pending: proposals.filter((p) => proposalPhase(p.status) === "pending"),
    // A merged or deleted session leaves its proposal started with nothing to open.
    started: proposals.filter(
      (p) =>
        proposalPhase(p.status) === "started" &&
        p.session_id !== null &&
        sessionIds.has(p.session_id),
    ),
    cleared: proposals.filter(
      (p) =>
        proposalPhase(p.status) === "cleared" &&
        p.cleared_at !== null &&
        p.cleared_at !== undefined &&
        now - p.cleared_at < INBOX_WINDOW_MS,
    ),
    failed,
    // A failed run is already listed as a failure; its report would ask twice.
    reports: runs.filter(
      (r) => r.status !== "failed" && reader.hasUnreadReport(r),
    ),
  };
}

export function isInboxEmpty(groups: InboxGroups<unknown, unknown>): boolean {
  return (
    groups.pending.length === 0 &&
    groups.reports.length === 0 &&
    groups.started.length === 0 &&
    groups.failed.length === 0 &&
    groups.cleared.length === 0
  );
}

/** How many things are actually waiting on you — what a badge shows. */
export function inboxActionCount(
  groups: InboxGroups<unknown, unknown>,
): number {
  return groups.pending.length + groups.failed.length + groups.reports.length;
}

/** The gateway's runs: an older computer never says `report_read`, so its failures age out. */
export const REMOTE_RUN_READER: InboxRunReader<{
  report_read?: boolean;
  status: RemoteAutomationRunStatus;
  unread_report: boolean;
}> = {
  isRead: (run) => run.report_read ?? false,
  hasUnreadReport: (run) =>
    run.unread_report && run.status !== "queued" && run.status !== "running",
};
