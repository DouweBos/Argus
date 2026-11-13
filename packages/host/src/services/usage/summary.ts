/**
 * Tokens and estimated cost over a range, per runner, model and speed tier:
 * hand-set prices first, then the runner's own reported cost, then the shared
 * model price list.
 */

import type { UsageRecord } from "./records";
import type {
  ClaudeUsageSummary,
  UsageModelFilter,
  UsagePriceOverride,
  UsageRange,
  UsageRunnerRow,
  UsageSeriesPoint,
} from "@argus/remote-protocol";
import { loadAppSettings } from "../appSettings/store";
import { getRunnerById } from "../llm/registry";
import { capture } from "../telemetry/telemetry";
import { recordFilter } from "./modelFilter";
import { loadPriceOverrides } from "./priceOverrides";
import { loadRateTable, partsTotal, type RateTable } from "./pricing";
import {
  countedModel,
  modelPrice,
  priceBook,
  priceRecord,
  type ModelPrice,
} from "./recordPricing";
import { loadAllUsageRecords } from "./sources";
import {
  addTokens,
  emptyTokens,
  ModelTallies,
  SpeedTallies,
} from "./summaryModels";

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

export interface SummaryOptions {
  overrides?: UsagePriceOverride[];
  filter?: UsageModelFilter;
}

export function summarize(
  records: UsageRecord[],
  table: RateTable,
  range: UsageRange,
  now: number,
  labelFor: (runner: string) => string = (runner) => runner,
  options: SummaryOptions = {},
): Omit<ClaudeUsageSummary, "prices_fetched_at"> {
  const starts = bucketStarts(range, now);
  const since = starts[0];
  const book = priceBook(table, options.overrides);
  const keep = recordFilter(options.filter);
  const series = starts.map((start) => ({ start, tokens: 0, cost_usd: 0 }));
  const tokens = emptyTokens();
  const cost = {
    total: 0,
    input: 0,
    cache_read: 0,
    cache_write: 0,
    output: 0,
    other: 0,
    premium: 0,
  };
  const models = new ModelTallies(starts);
  const speeds = new SpeedTallies();
  const runners = new Map<string, RunnerTally>();
  const prices = new Map<string, ModelPrice>();
  const seen = new Set<string>();
  let savings = 0;
  let bucket = 0;

  const sorted = records
    .filter((r) => r.at >= since && r.at <= now && keep(r))
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
    const counted = countedModel(book, r.model);
    let price = prices.get(counted.model);
    if (!price) {
      price = modelPrice(book, counted.model);
      prices.set(counted.model, price);
    }
    const priced = priceRecord(r, counted.model, price);
    const spent = partsTotal(priced.parts) + priced.other;
    const kinds = {
      input: r.input,
      cacheRead: r.cacheRead,
      cacheWrite: r.cacheWrite5m + r.cacheWrite1h,
      output: r.output,
    };
    const total = addTokens(tokens, kinds);

    cost.total += spent;
    cost.input += priced.parts.input;
    cost.cache_read += priced.parts.cache_read;
    cost.cache_write += priced.parts.cache_write;
    cost.output += priced.parts.output;
    cost.other += priced.other;
    cost.premium += priced.premium;
    savings += priced.savings;
    series[bucket].tokens += total;
    series[bucket].cost_usd += spent;
    speeds.add(r.speed ?? "standard", total, spent, priced.premium);

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

    models.add({
      runner: r.runner,
      model: counted.model,
      mappedFrom: counted.mapped ? r.model : null,
      priceSource: price.source,
      reported: r.costUsd !== null,
      tokens: kinds,
      cost: spent,
      bucket,
    });
  }

  const byCost = <T extends { cost_usd: number; tokens: number }>(a: T, b: T) =>
    b.cost_usd - a.cost_usd || b.tokens - a.tokens;
  const speedRows = speeds.list();

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
    models: models.list().sort(byCost),
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
    ...(speedRows ? { speeds: speedRows } : {}),
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
  const [records, prices] = await Promise.all([
    loadAllUsageRecords(since - FILE_SLACK_MS),
    loadRateTable(),
  ]);
  const summary = summarize(records, prices.table, range, now, runnerLabel, {
    overrides: loadPriceOverrides(),
    filter: loadAppSettings().usage_model_filter,
  });
  capture("usage_summary_loaded", {
    range,
    prices_available: prices.fetchedAt !== null,
    runner_count: summary.runners?.length ?? 0,
  });

  return { ...summary, prices_fetched_at: prices.fetchedAt };
}
