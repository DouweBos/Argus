import { describe, expect, it } from "vitest";
import {
  sessionActivity,
  sessionSubtitle,
  sessionTitle,
  shortAge,
} from "./sessionActivity";

const ready = {
  branch: "feat/x",
  display_name: null,
  status: "ready" as const,
};

describe("sessionActivity", () => {
  it("is idle with no dot when nothing runs", () => {
    const a = sessionActivity(ready, []);
    expect(a.state).toBe("idle");
    expect(a.showsDot).toBe(false);
    expect(a.statusText).toBeNull();
  });

  it("works while an agent runs and counts agents", () => {
    const a = sessionActivity(ready, [
      { status: "running", created_at: 5 },
      { status: "idle", last_activity_at: 9 },
    ]);
    expect(a.state).toBe("working");
    expect(a.tone).toBe("accent");
    expect(a.busy).toBe(true);
    expect(a.statusText).toBe("2 agents");
    expect(a.lastActive).toBe(9);
  });

  it("waits when an agent is blocked on you", () => {
    const a = sessionActivity(ready, [
      { status: "idle", awaiting: "question" },
    ]);
    expect(a.state).toBe("waiting");
    expect(a.tone).toBe("warning");
  });

  it("reads setup, failure and a missing drive", () => {
    expect(
      sessionActivity({ ...ready, status: "initializing" }, []).showsDot,
    ).toBe(true);
    expect(
      sessionActivity({ ...ready, status: "error", setup_error: "boom" }, [])
        .statusText,
    ).toBe("boom");
    expect(
      sessionActivity({ ...ready, availability: "unavailable" }, []).state,
    ).toBe("unavailable");
  });
});

describe("session titles", () => {
  it("prefers the display name and shows the branch beside it", () => {
    expect(sessionTitle(ready)).toBe("feat/x");
    expect(sessionSubtitle(ready)).toBeNull();
    const named = { ...ready, display_name: "Fix it" };
    expect(sessionTitle(named)).toBe("Fix it");
    expect(sessionSubtitle(named)).toBe("feat/x");
  });
});

describe("shortAge", () => {
  const now = 1_000_000_000_000;
  it("steps from now to weeks", () => {
    expect(shortAge(now - 10_000, now)).toBe("now");
    expect(shortAge(now - 5 * 60_000, now)).toBe("5m");
    expect(shortAge(now - 4 * 3_600_000, now)).toBe("4h");
    expect(shortAge(now - 3 * 86_400_000, now)).toBe("3d");
    expect(shortAge(now - 21 * 86_400_000, now)).toBe("3w");
  });
});
