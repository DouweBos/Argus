/**
 * Tokens and estimated cost over a range, from Claude Code transcripts priced
 * with the shared model price list.
 */

import type {
  ClaudeUsageSummary,
  UsageModelRow,
  UsageRange,
} from "@argus/remote-protocol";
import { capture } from "../telemetry/telemetry";
import { loadRateTable, rateFor, type RateTable } from "./pricing";
import { loadUsageRecords, type UsageRecord } from "./transcriptRecords";

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

export function summarize(
  records: UsageRecord[],
  table: RateTable,
  range: UsageRange,
  now: number,
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
  const cost = { total: 0, input: 0, cache_read: 0, cache_write: 0, output: 0 };
  const models = new Map<string, UsageModelRow>();
  const sessions = new Set<string>();
  const seen = new Set<string>();
  let savings = 0;
  let bucket = 0;

  const sorted = records
    .filter((r) => r.at >= since && r.at <= now)
    .sort((a, b) => a.at - b.at);
  for (const r of sorted) {
    // Repeated per content block, and copied into resumed or forked transcripts.
    if (r.key !== null) {
      if (seen.has(r.key)) {
        continue;
      }
      seen.add(r.key);
    }
    while (bucket + 1 < starts.length && starts[bucket + 1] <= r.at) {
      bucket += 1;
    }
    const cacheWrite = r.cacheWrite5m + r.cacheWrite1h;
    const total = r.input + r.cacheRead + cacheWrite + r.output;
    const rate = rateFor(table, r.model);
    const parts = rate
      ? {
          input: r.input * rate.input,
          cache_read: r.cacheRead * rate.cacheRead,
          cache_write:
            r.cacheWrite5m * rate.cacheWrite +
            r.cacheWrite1h * rate.cacheWrite1h,
          output: r.output * rate.output,
        }
      : { input: 0, cache_read: 0, cache_write: 0, output: 0 };
    const spent =
      parts.input + parts.cache_read + parts.cache_write + parts.output;

    tokens.processed += total;
    tokens.input += r.input;
    tokens.cache_read += r.cacheRead;
    tokens.cache_write += cacheWrite;
    tokens.output += r.output;
    cost.total += spent;
    cost.input += parts.input;
    cost.cache_read += parts.cache_read;
    cost.cache_write += parts.cache_write;
    cost.output += parts.output;
    if (rate) {
      savings += r.cacheRead * Math.max(0, rate.input - rate.cacheRead);
    }
    series[bucket].tokens += total;
    series[bucket].cost_usd += spent;
    if (r.sessionId) {
      sessions.add(r.sessionId);
    }
    const row = models.get(r.model) ?? {
      model: r.model,
      tokens: 0,
      cost_usd: 0,
      priced: rate !== null,
    };
    row.tokens += total;
    row.cost_usd += spent;
    models.set(r.model, row);
  }

  return {
    range,
    since,
    until: now,
    bucket: range === "24h" ? "hour" : "day",
    sessions: sessions.size,
    tokens,
    cost,
    cache_savings_usd: savings,
    series,
    models: [...models.values()].sort(
      (a, b) => b.cost_usd - a.cost_usd || b.tokens - a.tokens,
    ),
  };
}

export async function getClaudeUsageSummary(
  range: UsageRange,
): Promise<ClaudeUsageSummary> {
  const now = Date.now();
  const since = bucketStarts(range, now)[0];
  const [records, prices] = await Promise.all([
    loadUsageRecords(since - FILE_SLACK_MS),
    loadRateTable(),
  ]);
  capture("usage_summary_loaded", {
    range,
    prices_available: prices.fetchedAt !== null,
  });

  return {
    ...summarize(records, prices.table, range, now),
    prices_fetched_at: prices.fetchedAt,
  };
}
