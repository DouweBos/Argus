import { describe, expect, it } from "vitest";
import { decidedNote, proposalPrimary, proposalStartState } from "./proposals";

const CTA = {
  branch: null,
  force: false,
  label: "Start",
  url: null,
} as const;

describe("proposalPrimary", () => {
  it("starts, retries after a failure, and has nothing without a CTA", () => {
    expect(proposalPrimary({ ...CTA, kind: "start_session" })).toEqual({
      kind: "start",
      label: "Start",
    });
    expect(
      proposalPrimary({ ...CTA, kind: "start_session" }, true)?.label,
    ).toBe("Try again");
    expect(proposalPrimary(null)).toBeNull();
  });

  it("confirms a destructive cleanup and names the branch", () => {
    const primary = proposalPrimary({
      ...CTA,
      kind: "delete_branch",
      branch: "old",
      force: true,
      label: "Delete",
    });
    expect(primary).toMatchObject({ kind: "destroy" });
    expect(primary?.kind === "destroy" && primary.confirm).toContain(
      "git branch -D old",
    );
  });

  it("opens only with a url", () => {
    expect(proposalPrimary({ ...CTA, kind: "open_url" })).toBeNull();
    expect(
      proposalPrimary({ ...CTA, kind: "open_url", url: "https://x.test" }),
    ).toEqual({ kind: "open", label: "Start", url: "https://x.test" });
  });
});

describe("decidedNote", () => {
  it("is null while pending and names the automation when it withdrew", () => {
    expect(decidedNote({ status: "pending" }, "Triage")).toBeNull();
    expect(
      decidedNote({ status: "withdrawn", cleared_reason: "fixed" }, "Triage"),
    ).toBe("Triage withdrew this: fixed");
    expect(decidedNote({ status: "dismissed" }, null)).toBe(
      "You dismissed this.",
    );
  });
});

describe("proposalStartState", () => {
  it("prefers the host's stage, then the local request, then the error", () => {
    expect(
      proposalStartState({ start_error: "x", start_stage: "setting_up" }),
    ).toEqual({ progress: "Running setup…" });
    expect(
      proposalStartState(
        { start_error: null, start_stage: null },
        { requesting: true },
      ),
    ).toEqual({ progress: "Starting…" });
    expect(
      proposalStartState(
        { start_error: null, start_stage: null },
        { refusal: "busy" },
      ).error?.detail,
    ).toBe("busy");
  });
});
