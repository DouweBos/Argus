import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-ledger-"));
vi.mock("../../lib/argusHome", () => ({ argusHomeDir: () => home }));

const { loadLedgerRecords, resetLedgerCache } = await import("./ledger");
const { recordTurnUsage } = await import("./turns");

describe("recordTurnUsage", () => {
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
