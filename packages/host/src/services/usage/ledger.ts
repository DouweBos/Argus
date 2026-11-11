/**
 * Argus's own record of turns run by agents whose CLI keeps no usage history
 * we can read (the ACP agents and their custom variants). Claude Code and
 * Codex write their own, so they never land here and never count twice.
 */

import fs from "node:fs";
import path from "node:path";
import { warn } from "@argus/host/logger";
import { argusHomeDir } from "../../lib/argusHome";
import { JsonlScanner } from "./jsonlScan";
import { tokenCount, type UsageRecord } from "./records";

/** One finished turn as written to the ledger. */
export interface LedgerEntry {
  at: number;
  runner: string;
  model: string;
  agent_id: string;
  input: number;
  cache_read: number;
  cache_write: number;
  output: number;
  cost_usd: number | null;
}

export function ledgerPath(): string {
  return path.join(argusHomeDir(), "usage-ledger.jsonl");
}

export function appendLedgerEntry(
  entry: LedgerEntry,
  file = ledgerPath(),
): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
  } catch (e) {
    warn("[usage] could not record a turn's usage:", e);
  }
}

export function parseLedgerLine(line: string): UsageRecord | null {
  let e: Partial<LedgerEntry>;
  try {
    e = JSON.parse(line) as Partial<LedgerEntry>;
  } catch {
    return null;
  }
  if (
    typeof e.at !== "number" ||
    typeof e.runner !== "string" ||
    typeof e.model !== "string"
  ) {
    return null;
  }

  return {
    at: e.at,
    runner: e.runner,
    model: e.model,
    sessionId: typeof e.agent_id === "string" ? e.agent_id : "",
    key: null,
    input: tokenCount(e.input),
    cacheRead: tokenCount(e.cache_read),
    cacheWrite5m: tokenCount(e.cache_write),
    cacheWrite1h: 0,
    output: tokenCount(e.output),
    costUsd:
      typeof e.cost_usd === "number" && Number.isFinite(e.cost_usd)
        ? Math.max(0, e.cost_usd)
        : null,
  };
}

const scanner = new JsonlScanner<UsageRecord, undefined>(
  (line) => parseLedgerLine(line),
  () => undefined,
);

export async function loadLedgerRecords(
  file = ledgerPath(),
): Promise<UsageRecord[]> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(file);
  } catch {
    return [];
  }

  return scanner.records([
    { path: file, size: stat.size, mtimeMs: stat.mtimeMs },
  ]);
}

/** Test seam. */
export function resetLedgerCache(): void {
  scanner.reset();
}
