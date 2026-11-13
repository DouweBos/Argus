/**
 * One model of the usage summary in detail: its own trend, cache hit rate,
 * cost per million tokens, where its price comes from and the models mapped
 * into it. Mirrored by the native apps' model detail.
 */

import type { ClaudeUsageSummary, UsageModelRow } from "@argus/remote-protocol";
import { METRICS, type SummaryMetric } from "./summaryMetric";
import {
  bucketLabel,
  formatShare,
  formatTokens,
  formatUsd,
} from "./usageFormat";

/** Rows from hosts that predate runners were all Claude Code's. */
export const DEFAULT_MODEL_RUNNER = "claude-code";

/** What `/usage/:tab/models/:runner/:model` names. */
export interface UsageModelKey {
  runner: string;
  model: string;
}

export function usageModelKey(row: UsageModelRow): UsageModelKey {
  return { runner: row.runner ?? DEFAULT_MODEL_RUNNER, model: row.model };
}

export function findUsageModel(
  summary: ClaudeUsageSummary,
  key: UsageModelKey,
): UsageModelRow | null {
  return (
    summary.models.find(
      (m) =>
        m.model === key.model &&
        (m.runner ?? DEFAULT_MODEL_RUNNER) === key.runner,
    ) ?? null
  );
}

export type UsagePriceSource = NonNullable<UsageModelRow["price_source"]>;

const PRICE_SOURCE_LABELS: Record<UsagePriceSource, string> = {
  custom: "Your price",
  list: "API list price",
  none: "No price",
  reported: "Reported by the agent",
};

export function priceSourceOf(row: UsageModelRow): UsagePriceSource {
  return row.price_source ?? (row.priced ? "list" : "none");
}

/** Cache reads over everything read as input; null without any input. */
export function cacheHitRate(row: UsageModelRow): number | null {
  const kinds = row.token_kinds;
  if (!kinds) {
    return null;
  }
  const read = kinds.input + kinds.cache_read + kinds.cache_write;

  return read > 0 ? kinds.cache_read / read : null;
}

export interface UsageModelDetailView {
  title: string;
  /** "Claude Code". */
  runner: string;
  headline: string;
  caption: string;
  /** No price: offer to set one. */
  unpriced: boolean;
  chart: {
    caption: string;
    labels: string[];
    values: number[];
    kind: "bar" | "line";
    formatValue: (value: number) => string;
  } | null;
  stats: { label: string; value: string }[];
  /** Model ids counted as this one through a price mapping. */
  mappedFrom: string[];
}

export function usageModelDetailView(
  summary: ClaudeUsageSummary,
  row: UsageModelRow,
  metric: SummaryMetric,
): UsageModelDetailView {
  const view = METRICS[metric];
  const source = priceSourceOf(row);
  const unpriced = source === "none";
  const values = (row.series ?? []).map(view.point);
  const total =
    metric === "cost" ? summary.cost.total : summary.tokens.processed;
  const value = view.modelValue(row);
  const hit = cacheHitRate(row);
  const perMillion =
    !unpriced && row.tokens > 0 ? (row.cost_usd / row.tokens) * 1e6 : null;
  const runner = summary.runners?.find((r) => r.runner === row.runner);

  return {
    title: row.model,
    runner: runner?.label ?? row.runner ?? "Claude Code",
    headline: value === null ? "—" : view.format(value),
    caption:
      value === null
        ? "No price for this model; its tokens still count"
        : `${formatShare(value, total)} of the range`,
    unpriced,
    chart:
      values.length > 0
        ? {
            caption: view.chartTitle(summary.bucket),
            labels: (row.series ?? []).map((p) =>
              bucketLabel(p.start, summary.bucket),
            ),
            values,
            kind: values.length > 31 ? "line" : "bar",
            formatValue: view.axis,
          }
        : null,
    stats: [
      { label: "Cost", value: unpriced ? "—" : formatUsd(row.cost_usd) },
      { label: "Tokens", value: formatTokens(row.tokens) },
      {
        label: "Cache hit rate",
        value: hit === null ? "—" : `${String(Math.round(hit * 100))}%`,
      },
      {
        label: "Per million tokens",
        value: perMillion === null ? "—" : formatUsd(perMillion),
      },
      { label: "Price", value: PRICE_SOURCE_LABELS[source] },
    ],
    mappedFrom: row.mapped_from ?? [],
  };
}
