/**
 * Token usage from Grok CLI's saved sessions: every `turn_completed` update in
 * the `updates.jsonl` files under `$GROK_HOME/sessions` (default `~/.grok`).
 * Its cost comes in USD ticks.
 */

import os from "node:os";
import path from "node:path";
import { JsonlScanner, listJsonl } from "../jsonlScan";
import { tokenCount, type UsageRecord } from "../records";

export const GROK_RUNNER_ID = "grok";

const TICKS_PER_USD = 10_000_000_000;

type Json = Record<string, unknown>;

const isRecord = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

interface Totals {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  costUsd: number | null;
}

function readTotals(v: unknown): Totals | null {
  if (!isRecord(v)) {
    return null;
  }
  const ticks = v.costUsdTicks;
  const cacheRead = tokenCount(v.cachedReadTokens);
  const cacheWrite = tokenCount(v.cacheCreationTokens);

  return {
    // Grok counts cached tokens inside `inputTokens`; records keep them apart.
    input: Math.max(0, tokenCount(v.inputTokens) - cacheRead - cacheWrite),
    cacheRead,
    cacheWrite,
    output: tokenCount(v.outputTokens),
    costUsd:
      typeof ticks === "number" && Number.isFinite(ticks) && ticks >= 0
        ? ticks / TICKS_PER_USD
        : null,
  };
}

const sum = (t: Totals) => t.input + t.cacheRead + t.cacheWrite + t.output;

function timestampOf(rec: Json, params: Json): number | null {
  const meta = isRecord(params._meta) ? params._meta : {};
  if (
    typeof meta.agentTimestampMs === "number" &&
    Number.isFinite(meta.agentTimestampMs)
  ) {
    return meta.agentTimestampMs;
  }
  const ts = rec.timestamp;
  if (typeof ts === "number" && Number.isFinite(ts)) {
    return ts > 1e12 ? ts : ts * 1000;
  }
  if (typeof ts === "string") {
    const parsed = Date.parse(ts);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

/** One record per model a completed turn used. */
export function parseGrokLine(line: string): UsageRecord[] {
  if (!line.includes('"turn_completed"')) {
    return [];
  }
  let rec: unknown;
  try {
    rec = JSON.parse(line);
  } catch {
    return [];
  }
  if (!isRecord(rec) || !isRecord(rec.params)) {
    return [];
  }
  const params = rec.params;
  const update = isRecord(params.update) ? params.update : null;
  if (update?.sessionUpdate !== "turn_completed") {
    return [];
  }
  const at = timestampOf(rec, params);
  const top = readTotals(update.usage);
  if (at === null || !top) {
    return [];
  }
  const sessionId =
    typeof params.sessionId === "string" ? params.sessionId : "";
  const promptId =
    typeof update.prompt_id === "string" ? update.prompt_id : null;
  const make = (model: string, t: Totals, costUsd: number | null) => ({
    at,
    runner: GROK_RUNNER_ID,
    model,
    sessionId,
    // Without a prompt id two turns can't be told apart, so nothing is deduped.
    key: promptId === null ? null : `${sessionId}:${promptId}:${model}`,
    input: t.input,
    cacheRead: t.cacheRead,
    cacheWrite5m: t.cacheWrite,
    cacheWrite1h: 0,
    output: t.output,
    costUsd,
  });

  const usage = update.usage as Json;
  const perModel: { model: string; totals: Totals }[] = [];
  if (isRecord(usage.modelUsage)) {
    for (const [model, raw] of Object.entries(usage.modelUsage)) {
      const totals = readTotals(raw);
      if (model && totals && sum(totals) > 0) {
        perModel.push({ model, totals });
      }
    }
  }
  if (perModel.length === 0) {
    return sum(top) > 0 ? [make("grok", top, top.costUsd)] : [];
  }
  // Models without their own cost share what the turn's total leaves over, by tokens.
  let ticked = 0;
  let untickedTokens = 0;
  for (const { totals } of perModel) {
    if (totals.costUsd !== null) {
      ticked += totals.costUsd;
    } else {
      untickedTokens += sum(totals);
    }
  }
  const leftover =
    top.costUsd === null ? null : Math.max(0, top.costUsd - ticked);

  return perModel.map(({ model, totals }) =>
    make(
      model,
      totals,
      totals.costUsd ??
        (leftover !== null && untickedTokens > 0
          ? (leftover * sum(totals)) / untickedTokens
          : null),
    ),
  );
}

export function grokHome(): string {
  return process.env.GROK_HOME?.trim() || path.join(os.homedir(), ".grok");
}

const scanner = new JsonlScanner<UsageRecord, undefined>(
  (line) => parseGrokLine(line),
  () => undefined,
);

/** Every completed turn from session logs written to at or after `sinceMs`. */
export async function loadGrokUsageRecords(
  sinceMs: number,
  home = grokHome(),
): Promise<UsageRecord[]> {
  // Only `updates.jsonl` carries usage; the chat and event logs are larger.
  const found = await listJsonl(
    path.join(home, "sessions"),
    [],
    (name) => name === "updates.jsonl",
  );

  return scanner.records(found.filter((f) => f.mtimeMs >= sinceMs));
}

/** Test seam. */
export function resetGrokUsageCache(): void {
  scanner.reset();
}
