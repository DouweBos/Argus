import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  initialCodexState,
  loadCodexUsageRecords,
  parseCodexLine,
  resetCodexUsageCache,
} from "./codexRollouts";

const at = (s: number) =>
  new Date(Date.UTC(2026, 10, 1, 10, 0, s)).toISOString();
const meta = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    timestamp: at(0),
    type: "session_meta",
    payload: { id: "thread-1", ...extra },
  });
const context = (model: string, s = 1) =>
  JSON.stringify({
    timestamp: at(s),
    type: "turn_context",
    payload: { model },
  });
const usage = (input: number, cached: number, output: number) => ({
  input_tokens: input,
  cached_input_tokens: cached,
  output_tokens: output,
  reasoning_output_tokens: 0,
  total_tokens: input + output,
});
const count = (
  s: number,
  total: ReturnType<typeof usage> | null,
  last: ReturnType<typeof usage>,
) =>
  JSON.stringify({
    timestamp: at(s),
    type: "event_msg",
    payload: {
      type: "token_count",
      info: total
        ? { total_token_usage: total, last_token_usage: last }
        : { last_token_usage: last },
    },
  });

function parseAll(lines: string[]) {
  const state = initialCodexState();

  return lines.flatMap((l) => {
    const r = parseCodexLine(l, state);

    return r ? [r] : [];
  });
}

describe("parseCodexLine", () => {
  it("records the growth of cumulative totals under the current model", () => {
    const records = parseAll([
      meta(),
      context("gpt-5.5"),
      count(10, usage(1000, 200, 50), usage(1000, 200, 50)),
      // Repeated snapshot: nothing new ran.
      count(11, usage(1000, 200, 50), usage(1000, 200, 50)),
      count(20, usage(3000, 1200, 80), usage(2000, 1000, 30)),
    ]);
    expect(records).toHaveLength(2);
    expect(records[1]).toMatchObject({
      runner: "codex",
      model: "gpt-5.5",
      sessionId: "thread-1",
      input: 1000,
      cacheRead: 1000,
      output: 30,
      costUsd: null,
    });
  });

  it("skips a fork's copied history", () => {
    const records = parseAll([
      meta({ forked_from_id: "parent" }),
      context("gpt-5.5"),
      count(0, usage(5000, 0, 100), usage(5000, 0, 100)),
      count(10, usage(6000, 0, 150), usage(1000, 0, 50)),
    ]);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ input: 1000, output: 50 });
  });

  it("dedupes older rollouts that only carry the last request", () => {
    const records = parseAll([
      meta(),
      context("gpt-5"),
      count(10, null, usage(100, 0, 5)),
      count(11, null, usage(100, 0, 5)),
      count(12, null, usage(200, 0, 6)),
    ]);
    expect(records.map((r) => r.input)).toEqual([100, 200]);
  });
});

describe("loadCodexUsageRecords", () => {
  const dirs: string[] = [];
  afterEach(() => {
    resetCodexUsageCache();
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("reads live and archived rollouts only", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-home-"));
    dirs.push(home);
    const body =
      [
        meta(),
        context("gpt-5.5"),
        count(10, usage(10, 0, 1), usage(10, 0, 1)),
      ].join("\n") + "\n";
    fs.mkdirSync(path.join(home, "sessions", "2026", "11", "01"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(home, "archived_sessions"), { recursive: true });
    fs.writeFileSync(
      path.join(home, "sessions", "2026", "11", "01", "rollout-a.jsonl"),
      body,
    );
    fs.writeFileSync(
      path.join(home, "archived_sessions", "rollout-b.jsonl"),
      body,
    );
    fs.writeFileSync(path.join(home, "sessions", "history.jsonl"), body);

    await expect(loadCodexUsageRecords(0, home)).resolves.toHaveLength(2);
  });
});
