import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cursorRecords,
  loadCursorUsageRecords,
  resetCursorUsageCache,
  type CursorUsageDeps,
} from "./cursor";

const T = Date.UTC(2026, 10, 1, 10);
const HOUR = 60 * 60_000;

const jwt = (sub: string) =>
  `x.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.y`;

const event = (at: number, input: number, model = "claude-4.5-sonnet") => ({
  timestamp: String(at),
  model,
  kind: "USAGE_EVENT_KIND_INCLUDED_IN_PRO",
  tokenUsage: {
    inputTokens: input,
    outputTokens: 10,
    cacheReadTokens: 100,
    cacheWriteTokens: 5,
    totalCents: 1.5,
  },
});

type Event = ReturnType<typeof event>;

let dir: string;
let now: number;
let account: Event[];
let requests: { startDate: string; page: number }[];
let online: boolean;

function deps(token: string | null = jwt("user-1")): CursorUsageDeps {
  return {
    token: () => Promise.resolve(token),
    now: () => now,
    cacheFile: path.join(dir, "usage-cursor-account.json"),
    fetch: (_url, init) => {
      if (!online) {
        return Promise.reject(new Error("offline"));
      }
      const body = JSON.parse(String(init?.body)) as {
        page: number;
        pageSize: number;
        startDate: string;
        endDate: string;
      };
      requests.push({ startDate: body.startDate, page: body.page });
      const inWindow = account.filter(
        (e) =>
          Number(e.timestamp) >= Number(body.startDate) &&
          Number(e.timestamp) <= Number(body.endDate),
      );
      const start = (body.page - 1) * body.pageSize;

      return Promise.resolve(
        new Response(
          JSON.stringify({
            totalUsageEventsCount: inWindow.length,
            usageEventsDisplay: inWindow.slice(start, start + body.pageSize),
          }),
        ),
      );
    },
  };
}

describe("cursorRecords", () => {
  it("maps billed tokens and cents, and keeps identical events apart", () => {
    const records = cursorRecords(
      [event(T, 7), event(T, 7), event(T, 8, "gpt-5-fast")],
      "acct",
    );
    expect(records[0]).toMatchObject({
      at: T,
      runner: "cursor",
      model: "claude-4.5-sonnet",
      input: 7,
      cacheRead: 100,
      cacheWrite5m: 5,
      output: 10,
      costUsd: 0.015,
    });
    expect(records[0].speed).toBeUndefined();
    expect(records[2].speed).toBe("fast");
    expect(new Set(records.map((r) => r.key)).size).toBe(3);
    expect(records[0].key).toMatch(/^acct:[0-9a-f]+:0$/);
    expect(records[1].key).toMatch(/:1$/);
  });
});

describe("loadCursorUsageRecords", () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "argus-cursor-"));
    resetCursorUsageCache();
    now = T;
    account = [];
    requests = [];
    online = true;
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("fetches the window, then only the recent tail, without counting twice", async () => {
    account = [event(T - 10 * HOUR, 1), event(T - 30 * 60_000, 2)];
    const first = await loadCursorUsageRecords(T - 24 * HOUR, deps());
    expect(first.map((r) => r.input)).toEqual([1, 2]);
    expect(requests[0].startDate).toBe(String(T - 24 * HOUR));

    now = T + 2 * HOUR;
    account.push(event(T + HOUR, 3));
    const second = await loadCursorUsageRecords(T - 24 * HOUR, deps());

    expect(requests.at(-1)?.startDate).toBe(String(T - HOUR));
    expect(second.map((r) => r.input).sort()).toEqual([1, 2, 3]);
    expect(new Set(second.map((r) => r.key)).size).toBe(3);
  });

  it("serves a fresh read from memory", async () => {
    account = [event(T - HOUR, 1)];
    await loadCursorUsageRecords(T - 24 * HOUR, deps());
    now += 1000;
    await loadCursorUsageRecords(T - 24 * HOUR, deps());
    expect(requests).toHaveLength(1);
  });

  it("shows the saved totals when Cursor can't be reached", async () => {
    account = [event(T - HOUR, 1)];
    await loadCursorUsageRecords(T - 24 * HOUR, deps());

    resetCursorUsageCache();
    online = false;
    now = T + HOUR;
    const records = await loadCursorUsageRecords(T - 24 * HOUR, deps());

    expect(records.map((r) => r.input)).toEqual([1]);
  });

  it("starts over for another account", async () => {
    account = [event(T - HOUR, 1)];
    await loadCursorUsageRecords(T - 24 * HOUR, deps());
    now = T + 2 * 60_000;
    account = [event(T - HOUR, 9)];
    const records = await loadCursorUsageRecords(
      T - 24 * HOUR,
      deps(jwt("user-2")),
    );

    expect(records.map((r) => r.input)).toEqual([9]);
    expect(requests.at(-1)?.startDate).toBe(String(T - 24 * HOUR));
  });

  it("drops a page's head that repeats the previous page's tail", async () => {
    account = Array.from({ length: 1500 }, (_, i) => event(T - i * 1000, i));
    let shifted = false;
    const base = deps();
    const records = await loadCursorUsageRecords(T - 24 * HOUR, {
      ...base,
      fetch: async (url, init) => {
        const res = await base.fetch(url, init);
        const body = (await res.json()) as {
          totalUsageEventsCount: number;
          usageEventsDisplay: Event[];
        };
        // Page two starts one event early, as when an event lands mid-read.
        if (!shifted && body.usageEventsDisplay.length < 1000) {
          shifted = true;
          body.usageEventsDisplay.unshift(account[999]);
        }

        return new Response(JSON.stringify(body));
      },
    });

    expect(records).toHaveLength(1500);
    expect(new Set(records.map((r) => r.key)).size).toBe(1500);
  });

  it("returns nothing without a sign-in or cache", async () => {
    await expect(loadCursorUsageRecords(0, deps(null))).resolves.toEqual([]);
  });
});
