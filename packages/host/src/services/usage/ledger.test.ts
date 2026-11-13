import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-ledger-"));
vi.mock("../../lib/argusHome", () => ({ argusHomeDir: () => home }));

const { loadLedgerRecords, resetLedgerCache } = await import("./ledger");
const { recordTurnUsage } = await import("./turns");

describe("recordTurnUsage", () => {
  beforeAll(() => {
    // A fresh price list on disk, so pricing never reaches the network.
    fs.writeFileSync(
      path.join(home, "usage-model-prices-v3.json"),
      JSON.stringify({
        fetchedAt: Date.now(),
        rates: {
          "gpt-5.5": {
            input: 1e-6,
            output: 1e-5,
            cacheRead: 1e-7,
            cacheWrite: 1e-6,
            cacheWrite1h: 1e-6,
          },
        },
      }),
    );
  });

  afterEach(() => {
    resetLedgerCache();
    fs.rmSync(path.join(home, "usage-ledger.jsonl"), { force: true });
  });

  it("records ACP turns with the cost they reported", async () => {
    const cost = recordTurnUsage(
      { agentId: "a1", runnerId: "gemini", model: "gemini-3-pro", at: 5 },
      {
        total_cost_usd: 0.2,
        usage: {
          input_tokens: 30,
          cache_read_input_tokens: 20,
          output_tokens: 5,
        },
        modelUsage: { "gemini-3-pro": {} },
      },
    );
    expect(cost).toBe(0.2);
    await expect(loadLedgerRecords()).resolves.toEqual([
      {
        at: 5,
        runner: "gemini",
        model: "gemini-3-pro",
        sessionId: "a1",
        key: null,
        input: 30,
        cacheRead: 20,
        cacheWrite5m: 0,
        cacheWrite1h: 0,
        output: 5,
        costUsd: 0.2,
      },
    ]);
  });

  it("prices a Codex turn from its tokens, since Codex reports no cost", () => {
    const cost = recordTurnUsage(
      { agentId: "c", runnerId: "codex" },
      {
        usage: {
          input_tokens: 1000,
          cache_read_input_tokens: 10_000,
          output_tokens: 100,
        },
        modelUsage: { "gpt-5.5": {} },
      },
    );
    expect(cost).toBeCloseTo(1000 * 1e-6 + 10_000 * 1e-7 + 100 * 1e-5, 12);
  });

  it("leaves runners with their own history out, custom ones included", async () => {
    const turn = {
      total_cost_usd: 0.1,
      usage: { input_tokens: 10, output_tokens: 1 },
    };
    recordTurnUsage({ agentId: "a", runnerId: "claude-code" }, turn);
    recordTurnUsage({ agentId: "b", runnerId: "codex" }, turn);
    recordTurnUsage(
      { agentId: "c", runnerId: "my-codex", baseRunnerId: "codex" },
      turn,
    );
    recordTurnUsage({ agentId: "d", runnerId: "kiro" }, { usage: {} });
    await expect(loadLedgerRecords()).resolves.toEqual([]);
  });
});
