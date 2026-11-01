// Same vectors as ArgusCore's InboxStoreTests ("the phone's wire shapes group the same way").
import type {
  RemoteAutomationRunStatus,
  RemoteProposalStatus,
} from "@argus/remote-protocol";
import { describe, expect, it } from "vitest";
import {
  inboxActionCount,
  inboxGroups,
  isInboxEmpty,
  REMOTE_RUN_READER,
} from "./inbox";

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;

function proposal(
  id: string,
  status: RemoteProposalStatus,
  extra: { cleared_at?: number; session_id?: string } = {},
) {
  return {
    id,
    status,
    session_id: extra.session_id ?? null,
    cleared_at: extra.cleared_at ?? null,
  };
}

function run(
  id: string,
  status: RemoteAutomationRunStatus,
  extra: { report_read?: boolean; started_at?: number; unread?: boolean } = {},
) {
  return {
    id,
    status,
    started_at: extra.started_at ?? NOW,
    unread_report: extra.unread ?? false,
    report_read: extra.report_read,
  };
}

const PROPOSALS = [
  proposal("pending", "pending"),
  proposal("live", "accepted", { session_id: "s1" }),
  proposal("merged", "auto_started", { session_id: "gone" }),
  proposal("fresh", "withdrawn", { cleared_at: NOW - HOUR }),
  proposal("stale", "superseded", { cleared_at: NOW - 25 * HOUR }),
  proposal("no", "dismissed"),
];

const RUNS = [
  run("failed", "failed"),
  run("old-failure", "failed", { started_at: NOW - 25 * HOUR }),
  run("read-failure", "failed", { report_read: true }),
  run("report", "succeeded", { unread: true }),
  run("read-report", "succeeded"),
  run("running", "running", { unread: true }),
  run("failed-with-report", "failed", { unread: true }),
];

describe("inboxGroups", () => {
  const groups = inboxGroups({
    proposals: PROPOSALS,
    runs: RUNS,
    reader: REMOTE_RUN_READER,
    sessionIds: new Set(["s1"]),
    now: NOW,
  });
  const ids = (list: { id: string }[]) => list.map((x) => x.id);

  it("groups by what you would do about it", () => {
    expect(ids(groups.pending)).toEqual(["pending"]);
    expect(ids(groups.started)).toEqual(["live"]);
    expect(ids(groups.cleared)).toEqual(["fresh"]);
    expect(ids(groups.failed)).toEqual(["failed", "failed-with-report"]);
    expect(ids(groups.reports)).toEqual(["report"]);
  });

  it("counts what is waiting", () => {
    expect(inboxActionCount(groups)).toBe(4);
    expect(isInboxEmpty(groups)).toBe(false);
  });

  it("caps the failures it lists", () => {
    const many = Array.from({ length: 8 }, (_, i) => run(`f${i}`, "failed"));
    const capped = inboxGroups({
      proposals: [],
      runs: many,
      reader: REMOTE_RUN_READER,
      sessionIds: new Set(),
      now: NOW,
    });
    expect(capped.failed).toHaveLength(5);
  });
});
