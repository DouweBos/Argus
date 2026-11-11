/**
 * Tokens and estimated cost over a range, per runner: Claude Code transcripts,
 * Codex rollouts and Argus's ledger for the rest, priced with the shared model
 * price list unless the runner reported its own cost.
 */

import type { UsageRecord } from "./records";
import type {
  ClaudeUsageSummary,
  UsageModelRow,
  UsageRange,
  UsageRunnerRow,
  UsageSeriesPoint,
} from "@argus/remote-protocol";
import { getRunnerById } from "../llm/registry";
import { capture } from "../telemetry/telemetry";
import { loadCodexUsageRecords } from "./codexRollouts";
import { loadLedgerRecords } from "./ledger";
import {
  costParts,
  loadRateTable,
  partsTotal,
  rateFor,
  type CostParts,
  type RateTable,
} from "./pricing";
import { loadUsageRecords } from "./transcriptRecords";

const HOUR_MS = 60 * 60_000;
const DAYS: Record<Exclude<UsageRange, "24h">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};
/** A transcript last written before the range can't hold records inside it… unless its clock ran late. */
const FILE_SLACK_MS = 36 * HOUR_MS;

/** Bucket starts for the range: hours for 24 h, local days otherwise. */
export function bucketStarts(range: UsageRange, now: number): number[] {
  if (range === "24h") {
    const hour = Math.floor(now / HOUR_MS) * HOUR_MS;

    return Array.from({ length: 24 }, (_, i) => hour - (23 - i) * HOUR_MS);
  }
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const days = DAYS[range];

  return Array.from({ length: days }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (days - 1 - i));

    return d.getTime();
  });
}

interface RunnerTally {
  sessions: Set<string>;
  tokens: number;
  cost: number;
  priced: boolean;
  series: UsageSeriesPoint[];
}

/** What one record cost, by kind; reported spend without a list rate is `other`. */
function priceRecord(
  r: UsageRecord,
  table: RateTable,
): { parts: CostParts; other: number; priced: boolean } {
  const rate = rateFor(table, r.model);
  const zero = { input: 0, cache_read: 0, cache_write: 0, output: 0 };
  if (!rate) {
    return r.costUsd === null
      ? { parts: zero, other: 0, priced: false }
      : { parts: zero, other: r.costUsd, priced: true };
  }
  const parts = costParts(rate, r);
  const estimate = partsTotal(parts);
  if (r.costUsd === null) {
    return { parts, other: 0, priced: true };
  }
  // The runner's own figure wins; the list rates only say how it splits.
  if (estimate <= 0) {
    return { parts: zero, other: r.costUsd, priced: true };
  }
  const scale = r.costUsd / estimate;

  return {
    parts: {
      input: parts.input * scale,
      cache_read: parts.cache_read * scale,
      cache_write: parts.cache_write * scale,
      output: parts.output * scale,
    },
    other: 0,
    priced: true,
  };
}

export function summarize(
  records: UsageRecord[],
  table: RateTable,
  range: UsageRange,
  now: number,
  labelFor: (runner: string) => string = (runner) => runner,
): Omit<ClaudeUsageSummary, "prices_fetched_at"> {
  const starts = bucketStarts(range, now);
  const since = starts[0];
  const series = starts.map((start) => ({ start, tokens: 0, cost_usd: 0 }));
  const tokens = {
    processed: 0,
    input: 0,
    cache_read: 0,
    cache_write: 0,
    output: 0,
  };
  const cost = {
    total: 0,
    input: 0,
    cache_read: 0,
    cache_write: 0,
    output: 0,
    other: 0,
  };
  const models = new Map<string, UsageModelRow>();
  const runners = new Map<string, RunnerTally>();
  const seen = new Set<string>();
  let savings = 0;
  let bucket = 0;

  const sorted = records
    .filter((r) => r.at >= since && r.at <= now)
    .sort((a, b) => a.at - b.at);
  for (const r of sorted) {
    // Repeated per content block, and copied into resumed or forked transcripts.
    if (r.key !== null) {
      const key = `${r.runner}\u0000${r.key}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
    }
    while (bucket + 1 < starts.length && starts[bucket + 1] <= r.at) {
      bucket += 1;
    }
    const cacheWrite = r.cacheWrite5m + r.cacheWrite1h;
    const total = r.input + r.cacheRead + cacheWrite + r.output;
    const priced = priceRecord(r, table);
    const spent = partsTotal(priced.parts) + priced.other;
    const rate = rateFor(table, r.model);

    tokens.processed += total;
    tokens.input += r.input;
    tokens.cache_read += r.cacheRead;
    tokens.cache_write += cacheWrite;
    tokens.output += r.output;
    cost.total += spent;
    cost.input += priced.parts.input;
    cost.cache_read += priced.parts.cache_read;
    cost.cache_write += priced.parts.cache_write;
    cost.output += priced.parts.output;
    cost.other += priced.other;
    if (rate) {
      savings += r.cacheRead * Math.max(0, rate.input - rate.cacheRead);
    }
    series[bucket].tokens += total;
    series[bucket].cost_usd += spent;

    const tally = runners.get(r.runner) ?? {
      sessions: new Set<string>(),
      tokens: 0,
      cost: 0,
      priced: false,
      series: starts.map((start) => ({ start, tokens: 0, cost_usd: 0 })),
    };
    if (r.sessionId) {
      tally.sessions.add(r.sessionId);
    }
    tally.tokens += total;
    tally.cost += spent;
    tally.priced ||= priced.priced;
    tally.series[bucket].tokens += total;
    tally.series[bucket].cost_usd += spent;
    runners.set(r.runner, tally);

    const modelKey = `${r.runner}\u0000${r.model}`;
    const row = models.get(modelKey) ?? {
      model: r.model,
      tokens: 0,
      cost_usd: 0,
      priced: false,
      runner: r.runner,
    };
    row.tokens += total;
    row.cost_usd += spent;
    row.priced ||= priced.priced;
    models.set(modelKey, row);
  }

  const byCost = <T extends { cost_usd: number; tokens: number }>(a: T, b: T) =>
    b.cost_usd - a.cost_usd || b.tokens - a.tokens;

  return {
    range,
    since,
    until: now,
    bucket: range === "24h" ? "hour" : "day",
    sessions: [...runners.values()].reduce((n, t) => n + t.sessions.size, 0),
    tokens,
    cost,
    cache_savings_usd: savings,
    series,
    models: [...models.values()].sort(byCost),
    runners: [...runners.entries()]
      .map(
        ([runner, t]): UsageRunnerRow => ({
          runner,
          label: labelFor(runner),
          sessions: t.sessions.size,
          tokens: t.tokens,
          cost_usd: t.cost,
          priced: t.priced,
          series: t.series,
        }),
      )
      .sort(byCost),
  };
}

function runnerLabel(runner: string): string {
  return getRunnerById(runner)?.displayName ?? runner;
}

export async function getClaudeUsageSummary(
  range: UsageRange,
): Promise<ClaudeUsageSummary> {
  const now = Date.now();
  const since = bucketStarts(range, now)[0];
  const [claude, codex, ledger, prices] = await Promise.all([
    loadUsageRecords(since - FILE_SLACK_MS),
    loadCodexUsageRecords(since - FILE_SLACK_MS),
    loadLedgerRecords(),
    loadRateTable(),
  ]);
  const summary = summarize(
    [...claude, ...codex, ...ledger],
    prices.table,
    range,
    now,
    runnerLabel,
  );
  capture("usage_summary_loaded", {
    range,
    prices_available: prices.fetchedAt !== null,
    runner_count: summary.runners?.length ?? 0,
  });

  return { ...summary, prices_fetched_at: prices.fetchedAt };
}
