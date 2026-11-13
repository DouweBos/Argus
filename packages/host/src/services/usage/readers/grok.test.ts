import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadGrokUsageRecords,
  parseGrokLine,
  resetGrokUsageCache,
} from "./grok";

const T = Date.UTC(2026, 10, 1, 10);
const TICKS = 10_000_000_000;

const turn = (usage: object, promptId: string | null = "p-1") =>
  JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    timestamp: T / 1000,
    params: {
      sessionId: "s-1",
      _meta: { agentTimestampMs: T },
      update: {
        sessionUpdate: "turn_completed",
        ...(promptId ? { prompt_id: promptId } : {}),
        usage,
      },
    },
  });

describe("parseGrokLine", () => {
  it("splits cached tokens out of input and converts ticks to dollars", () => {
    const [rec] = parseGrokLine(
      turn({
        inputTokens: 1000,
        cachedReadTokens: 600,
        outputTokens: 50,
        costUsdTicks: 0.02 * TICKS,
      }),
    );
    expect(rec).toEqual({
      at: T,
      runner: "grok",
      model: "grok",
      sessionId: "s-1",
      key: "s-1:p-1:grok",
      input: 400,
      cacheRead: 600,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
      output: 50,
      costUsd: 0.02,
    });
  });

  it("gives each model its own record and shares unticked cost by tokens", () => {
    const records = parseGrokLine(
      turn({
        inputTokens: 300,
        outputTokens: 30,
        costUsdTicks: 0.1 * TICKS,
        modelUsage: {
          "grok-4": {
            inputTokens: 100,
            outputTokens: 0,
            costUsdTicks: 0.04 * TICKS,
          },
          "grok-code-fast-1": { inputTokens: 150, outputTokens: 0 },
          "grok-3-mini": { inputTokens: 50, outputTokens: 0 },
        },
      }),
    );
    expect(records.map((r) => [r.model, r.costUsd?.toFixed(3)])).toEqual([
      ["grok-4", "0.040"],
      ["grok-code-fast-1", "0.045"],
      ["grok-3-mini", "0.015"],
    ]);
  });

  it("leaves turns without a prompt id undeduped and ignores other updates", () => {
    expect(parseGrokLine(turn({ inputTokens: 5 }, null))[0].key).toBeNull();
    expect(
      parseGrokLine(
        JSON.stringify({
          params: { update: { sessionUpdate: "agent_message_chunk" } },
        }),
      ),
    ).toEqual([]);
    expect(parseGrokLine("not json turn_completed")).toEqual([]);
  });
});

describe("loadGrokUsageRecords", () => {
  let home: string | null = null;

  afterEach(() => {
    resetGrokUsageCache();
    if (home) {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("reads only updates.jsonl under sessions, including appended turns", async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-grok-"));
    const session = path.join(home, "sessions", "proj", "s-1");
    fs.mkdirSync(session, { recursive: true });
    const updates = path.join(session, "updates.jsonl");
    fs.writeFileSync(updates, `${turn({ inputTokens: 10 })}\n`);
    fs.writeFileSync(
      path.join(session, "chat_history.jsonl"),
      `${turn({ inputTokens: 99 }, "p-9")}\n`,
    );

    await expect(loadGrokUsageRecords(0, home)).resolves.toHaveLength(1);

    fs.appendFileSync(updates, `${turn({ outputTokens: 7 }, "p-2")}\n`);
    const records = await loadGrokUsageRecords(0, home);
    expect(records.map((r) => r.key)).toEqual(["s-1:p-1:grok", "s-1:p-2:grok"]);
  });

  it("returns nothing without a Grok home", async () => {
    await expect(loadGrokUsageRecords(0, "/nonexistent/grok")).resolves.toEqual(
      [],
    );
  });
});
