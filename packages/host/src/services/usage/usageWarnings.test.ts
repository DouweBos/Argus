import type { UsageLimitWindow } from "@argus/remote-protocol";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadFiredWarnings, saveFiredWarnings } from "./usageWarningLog";
import {
  dueWarnings,
  pruneFired,
  resetPhrase,
  thresholdBucket,
  usageWarningThreshold,
  warningText,
} from "./usageWarnings";

const NOW = Date.UTC(2026, 10, 25, 10, 0);
const HOUR = 3_600_000;

function win(
  id: string,
  used: number,
  resetsAt: number | null = NOW + 2 * HOUR,
): UsageLimitWindow {
  return {
    id,
    kind: "session",
    label: id === "seven_day" ? "Weekly" : "Session",
    used_percent: used,
    resets_at: resetsAt,
    window_minutes: 300,
    pace: null,
  };
}

describe("usageWarningThreshold", () => {
  it("defaults to 90 and treats 0 as off", () => {
    expect(usageWarningThreshold(undefined)).toBe(90);
    expect(usageWarningThreshold(80)).toBe(80);
    expect(usageWarningThreshold(0)).toBeNull();
  });

  it("buckets to the values Settings offers", () => {
    expect(thresholdBucket(95)).toBe("95");
    expect(thresholdBucket(42)).toBe("other");
  });
});

describe("dueWarnings", () => {
  it("fires once a window reaches the threshold", () => {
    expect(
      dueWarnings("codex", null, [win("five_hour", 89)], 90, {}, NOW).due,
    ).toEqual([]);
    const crossed = dueWarnings(
      "codex",
      null,
      [win("five_hour", 90)],
      90,
      {},
      NOW,
    );
    expect(crossed.due.map((w) => w.id)).toEqual(["five_hour"]);
    expect(crossed.changed).toBe(true);
  });

  it("fires only once per window", () => {
    const first = dueWarnings(
      "claude-code",
      "a1",
      [win("five_hour", 91)],
      90,
      {},
      NOW,
    );
    const again = dueWarnings(
      "claude-code",
      "a1",
      [win("five_hour", 97)],
      90,
      first.fired,
      NOW + HOUR,
    );
    expect(again.due).toEqual([]);
    expect(again.changed).toBe(false);
  });

  it("keeps accounts and runners apart", () => {
    const first = dueWarnings(
      "claude-code",
      "a1",
      [win("five_hour", 91)],
      90,
      {},
      NOW,
    );
    const other = dueWarnings(
      "claude-code",
      "a2",
      [win("five_hour", 91)],
      90,
      first.fired,
      NOW,
    );
    expect(other.due).toHaveLength(1);
  });

  it("fires again in the next window", () => {
    const first = dueWarnings(
      "codex",
      null,
      [win("five_hour", 95, NOW + HOUR)],
      90,
      {},
      NOW,
    );
    const next = dueWarnings(
      "codex",
      null,
      [win("five_hour", 92, NOW + 6 * HOUR)],
      90,
      first.fired,
      NOW + 2 * HOUR,
    );
    expect(next.due).toHaveLength(1);
  });

  it("starts over when usage drops back under, for windows without a reset", () => {
    const first = dueWarnings(
      "cursor",
      null,
      [win("monthly", 93, null)],
      90,
      {},
      NOW,
    );
    const dropped = dueWarnings(
      "cursor",
      null,
      [win("monthly", 5, null)],
      90,
      first.fired,
      NOW,
    );
    expect(dropped.fired).toEqual({});
    expect(
      dueWarnings(
        "cursor",
        null,
        [win("monthly", 91, null)],
        90,
        dropped.fired,
        NOW,
      ).due,
    ).toHaveLength(1);
  });

  it("ignores a reading whose window already reset", () => {
    expect(
      dueWarnings("codex", null, [win("five_hour", 99, NOW - 1)], 90, {}, NOW)
        .due,
    ).toEqual([]);
  });

  it("puts the tightest window first", () => {
    const { due } = dueWarnings(
      "claude-code",
      "a1",
      [win("five_hour", 91), win("seven_day", 96)],
      90,
      {},
      NOW,
    );
    expect(due.map((w) => w.id)).toEqual(["seven_day", "five_hour"]);
  });
});

describe("pruneFired", () => {
  it("drops windows that have reset", () => {
    expect(
      pruneFired(
        {
          old: { resets_at: NOW - 1 },
          live: { resets_at: NOW + 1 },
          open: { resets_at: null },
        },
        NOW,
      ),
    ).toEqual({ live: { resets_at: NOW + 1 }, open: { resets_at: null } });
  });
});

describe("warning text", () => {
  it("names the reset relative to today", () => {
    expect(resetPhrase(NOW + 4 * HOUR, NOW, "UTC")).toBe("today at 14:00");
    expect(resetPhrase(NOW + 24 * HOUR, NOW, "UTC")).toBe("tomorrow at 10:00");
    expect(resetPhrase(NOW + 72 * HOUR, NOW, "UTC")).toBe("Sat at 10:00");
    expect(resetPhrase(NOW + 240 * HOUR, NOW, "UTC")).toBe("Dec 5 at 10:00");
  });

  it("names the runner, the window, the account and where to switch", () => {
    expect(
      warningText({
        runnerLabel: "Claude Code",
        accountLabel: "Work",
        window: win("seven_day", 91.6, NOW + 4 * HOUR),
        switchLabel: "Personal",
        now: NOW,
        timeZone: "UTC",
      }),
    ).toEqual({
      title: "Claude Code is at 91% of its limit",
      body: "Weekly limit on Work, resets today at 14:00. Switch to Personal to keep going.",
    });
  });

  it("leaves out what it doesn't know", () => {
    expect(
      warningText({
        runnerLabel: "Cursor",
        accountLabel: null,
        window: win("five_hour", 90, null),
        switchLabel: null,
        now: NOW,
      }).body,
    ).toBe("Session limit.");
  });
});

describe("the warning log", () => {
  const previous = process.env.ARGUS_HOME;
  afterEach(() => {
    if (previous === undefined) {
      Reflect.deleteProperty(process.env, "ARGUS_HOME");
    } else {
      process.env.ARGUS_HOME = previous;
    }
  });

  it("survives a restart", () => {
    process.env.ARGUS_HOME = fs.mkdtempSync(
      path.join(os.tmpdir(), "usage-warn-"),
    );
    expect(loadFiredWarnings()).toEqual({});
    saveFiredWarnings({ "codex||five_hour": { resets_at: NOW } });
    expect(loadFiredWarnings()).toEqual({
      "codex||five_hour": { resets_at: NOW },
    });
  });
});
