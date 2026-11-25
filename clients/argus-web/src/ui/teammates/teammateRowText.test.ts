import type { TeammateSummary, TeammateThread } from "@argus/remote-protocol";
import { describe, expect, it } from "vitest";
import { teammateLastActivityAt, teammatePreview } from "./teammateRowText";

const summary = {
  teammate: { tagline: "Fixes CI" },
  duty_count: 2,
  last_run_at: null,
  has_unread_report: false,
} as unknown as TeammateSummary;

const thread = (title: string, opened: number) =>
  ({ title, last_opened_at: opened }) as TeammateThread;

describe("teammatePreview", () => {
  it("prefers work, then the latest conversation, then the tagline", () => {
    const talked = { ...summary, latest_thread: thread("Flaky login", 5) };
    expect(teammatePreview({ ...talked, working: true })).toBe("Working on a duty");
    expect(teammatePreview(talked)).toBe("Flaky login");
    expect(teammatePreview({ ...summary, latest_thread: thread(" ", 5) })).toBe("Fixes CI");
    expect(
      teammatePreview({ ...summary, teammate: { ...summary.teammate, tagline: "" } }),
    ).toBe("No conversations yet");
  });
});

describe("teammateLastActivityAt", () => {
  it("is the later of a run and a conversation", () => {
    expect(teammateLastActivityAt(summary)).toBeNull();
    expect(teammateLastActivityAt({ ...summary, last_run_at: 9, latest_thread: thread("x", 5) })).toBe(9);
    expect(teammateLastActivityAt({ ...summary, last_run_at: 9, latest_thread: thread("x", 12) })).toBe(12);
  });
});
