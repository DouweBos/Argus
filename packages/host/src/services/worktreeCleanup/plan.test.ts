import { describe, expect, it } from "vitest";
import { DAY_MS, type InspectedWorktree, planCleanup } from "./plan";

const NOW = 100 * DAY_MS;
const GB = 1024 ** 3;

function wt(
  id: string,
  over: Partial<InspectedWorktree> = {},
): InspectedWorktree {
  return {
    session_id: id,
    repo_root: "/repo",
    project_name: "repo",
    branch: id,
    display_name: null,
    bytes: GB,
    last_activity_at: NOW,
    landed_at: null,
    blocked_by: null,
    ...over,
  };
}

const policy = { enabled: true, landed_days: 7, idle_days: 30, max_gb: 0 };

describe("planCleanup", () => {
  it("removes sessions landed past the limit, not before", () => {
    const { entries } = planCleanup(
      [
        wt("old", { landed_at: NOW - 8 * DAY_MS }),
        wt("fresh", { landed_at: NOW - 2 * DAY_MS }),
      ],
      policy,
      NOW,
    );
    expect(entries.map((e) => [e.session_id, e.reason])).toEqual([
      ["old", "landed"],
    ]);
  });

  it("removes sessions idle past the limit", () => {
    const { entries } = planCleanup(
      [wt("idle", { last_activity_at: NOW - 31 * DAY_MS }), wt("busy")],
      policy,
      NOW,
    );
    expect(entries.map((e) => e.session_id)).toEqual(["idle"]);
    expect(entries[0].reason).toBe("idle");
  });

  it("lists guarded sessions after removable ones, still guarded", () => {
    const { entries } = planCleanup(
      [
        wt("dirty", {
          last_activity_at: NOW - 90 * DAY_MS,
          blocked_by: "uncommitted",
        }),
        wt("idle", { last_activity_at: NOW - 40 * DAY_MS }),
      ],
      policy,
      NOW,
    );
    expect(entries.map((e) => [e.session_id, e.blocked_by])).toEqual([
      ["idle", null],
      ["dirty", "uncommitted"],
    ]);
  });

  it("zero turns a rule off", () => {
    const { entries } = planCleanup(
      [wt("a", { landed_at: 0, last_activity_at: 0 })],
      { ...policy, landed_days: 0, idle_days: 0 },
      NOW,
    );
    expect(entries).toEqual([]);
  });

  it("evicts the least recently used until under the cap", () => {
    const { entries, total_bytes } = planCleanup(
      [
        wt("newest", { last_activity_at: NOW - 2 * DAY_MS }),
        wt("oldest", { last_activity_at: NOW - 5 * DAY_MS }),
        wt("middle", { last_activity_at: NOW - 3 * DAY_MS }),
        wt("today", { last_activity_at: NOW - 1000 }),
      ],
      { ...policy, max_gb: 2 },
      NOW,
    );
    expect(total_bytes).toBe(4 * GB);
    expect(entries.map((e) => [e.session_id, e.reason])).toEqual([
      ["oldest", "over_cap"],
      ["middle", "over_cap"],
    ]);
  });

  it("counts other removals before evicting for the cap", () => {
    const { entries } = planCleanup(
      [
        wt("landed", { landed_at: 0, bytes: 3 * GB }),
        wt("other", { last_activity_at: NOW - 5 * DAY_MS }),
      ],
      { ...policy, max_gb: 2 },
      NOW,
    );
    expect(entries.map((e) => e.session_id)).toEqual(["landed"]);
  });

  it("never evicts a guarded session for the cap", () => {
    const { entries } = planCleanup(
      [
        wt("agent", {
          last_activity_at: NOW - 5 * DAY_MS,
          blocked_by: "agent_running",
          bytes: 10 * GB,
        }),
      ],
      { ...policy, max_gb: 1 },
      NOW,
    );
    expect(entries).toEqual([]);
  });
});
