import type { CliProjectCandidate } from "./types";
import { describe, expect, it } from "vitest";
import {
  defaultSelection,
  formatChatCount,
  formatShortAge,
  truncateMiddle,
} from "./cliProjectImport";

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

describe("formatShortAge", () => {
  it("buckets by the largest whole unit", () => {
    expect(formatShortAge(NOW - 10_000, NOW)).toBe("now");
    expect(formatShortAge(NOW - MIN, NOW)).toBe("1m");
    expect(formatShortAge(NOW - 4 * 60 * MIN - 5 * MIN, NOW)).toBe("4h");
    expect(formatShortAge(NOW - 6 * DAY, NOW)).toBe("6d");
    expect(formatShortAge(NOW - 95 * DAY, NOW)).toBe("3mo");
    expect(formatShortAge(NOW - 800 * DAY, NOW)).toBe("2y");
  });

  it("treats future timestamps as now", () => {
    expect(formatShortAge(NOW + 5 * MIN, NOW)).toBe("now");
  });
});

describe("truncateMiddle", () => {
  it("leaves short text alone", () => {
    expect(truncateMiddle("/a/b", 10)).toBe("/a/b");
  });

  it("keeps both ends of long text", () => {
    const out = truncateMiddle("/Users/me/Work/clients/acme/app", 15);
    expect(out).toHaveLength(15);
    expect(out).toBe("/Users/…cme/app");
  });
});

describe("defaultSelection", () => {
  const candidate = (
    path: string,
    over: Partial<CliProjectCandidate> = {},
  ): CliProjectCandidate => ({
    path,
    name: path,
    chat_count: 5,
    last_active_at: NOW - DAY,
    added: false,
    ...over,
  });

  it("ticks busy, recent, new projects only", () => {
    const picked = defaultSelection(
      [
        candidate("/busy"),
        candidate("/added", { added: true }),
        candidate("/quiet", { chat_count: 2 }),
        candidate("/stale", { last_active_at: NOW - 31 * DAY }),
        candidate("/edge", { chat_count: 3, last_active_at: NOW - 30 * DAY }),
      ],
      NOW,
    );
    expect([...picked]).toEqual(["/busy", "/edge"]);
  });
});

describe("formatChatCount", () => {
  it("pluralises", () => {
    expect(formatChatCount(1)).toBe("1 chat");
    expect(formatChatCount(4)).toBe("4 chats");
  });
});
