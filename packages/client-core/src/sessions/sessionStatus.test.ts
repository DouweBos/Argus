import { describe, expect, it } from "vitest";
import {
  archivedSessions,
  effectiveWorkflowStatus,
  setWorkflowStatus,
} from "./sessionStatus";

const pr = (state: "closed" | "draft" | "merged" | "open") => ({
  number: 1,
  state,
  url: "https://x/1",
});

describe("effectiveWorkflowStatus", () => {
  it("prefers a set status over the pull request and an older settle", () => {
    expect(
      effectiveWorkflowStatus({
        workflow_status: "in_review",
        settled: false,
        pull_request: pr("merged"),
      }),
    ).toBe("in_review");
  });

  it("follows the pull request when nothing is set", () => {
    expect(effectiveWorkflowStatus({ pull_request: pr("open") })).toBe(
      "in_review",
    );
    expect(effectiveWorkflowStatus({ pull_request: pr("closed") })).toBe(
      "done",
    );
    expect(effectiveWorkflowStatus({})).toBeNull();
  });

  it("reads an older host's settle as done or in progress", () => {
    expect(setWorkflowStatus({ settled: true })).toBe("done");
    expect(setWorkflowStatus({ settled: false })).toBe("in_progress");
    expect(setWorkflowStatus({ settled: null })).toBeNull();
  });
});

describe("archivedSessions", () => {
  it("keeps the archived ones, newest archived first", () => {
    const list = [
      { id: "a", archived_at: 1 },
      { id: "b", archived_at: null },
      { id: "c", archived_at: 5 },
    ];
    expect(archivedSessions(list).map((s) => s.id)).toEqual(["c", "a"]);
  });
});
