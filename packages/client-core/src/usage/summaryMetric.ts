import type {
  ClaudeUsageSummary,
  UsageModelRow,
  UsageRunnerRow,
} from "@argus/remote-protocol";
import { formatTokens, formatUsd, formatUsdCompact } from "./usageFormat";

/** The cost and tokens tabs of the usage screen. */
export type SummaryMetric = "cost" | "tokens";

export interface SummaryPart {
  label: string;
  value: number;
  /** A catch-all drawn in the neutral colour. */
  other?: boolean;
}

/** What the cost and tokens tabs read off the same summary. */
export interface MetricView {
  axis: (value: number) => string;
  chartTitle: (bucket: ClaudeUsageSummary["bucket"]) => string;
  format: (value: number) => string;
  headline: (s: ClaudeUsageSummary) => string;
  /** The model's value; null when it can't be measured (an unpriced model's cost). */
  modelValue: (m: UsageModelRow) => number | null;
  /** The runner's value; null for an unpriced runner's cost. */
  runnerValue: (r: UsageRunnerRow) => number | null;
  parts: (s: ClaudeUsageSummary) => SummaryPart[];
  partsTitle: string;
  point: (p: ClaudeUsageSummary["series"][number]) => number;
}

export const METRICS: Record<SummaryMetric, MetricView> = {
  cost: {
    headline: (s) => formatUsd(s.cost.total),
    chartTitle: (bucket) => (bucket === "hour" ? "Hourly cost" : "Daily cost"),
    point: (p) => p.cost_usd,
    format: formatUsd,
    axis: formatUsdCompact,
    partsTitle: "Cost by type",
    parts: (s) => [
      { label: "Input", value: s.cost.input },
      { label: "Cache read", value: s.cost.cache_read },
      { label: "Cache write", value: s.cost.cache_write },
      { label: "Output", value: s.cost.output },
      // Reported cost for models without list prices can't be split by kind.
      ...((s.cost.other ?? 0) > 0
        ? [{ label: "Other", value: s.cost.other ?? 0, other: true }]
        : []),
    ],
    modelValue: (m) => (m.priced ? m.cost_usd : null),
    runnerValue: (r) => (r.priced ? r.cost_usd : null),
  },
  tokens: {
    headline: (s) => formatTokens(s.tokens.processed),
    chartTitle: (bucket) =>
      bucket === "hour" ? "Hourly processed tokens" : "Daily processed tokens",
    point: (p) => p.tokens,
    format: formatTokens,
    axis: formatTokens,
    partsTitle: "Tokens by type",
    parts: (s) => [
      { label: "Input", value: s.tokens.input },
      { label: "Cache read", value: s.tokens.cache_read },
      { label: "Cache write", value: s.tokens.cache_write },
      { label: "Output", value: s.tokens.output },
    ],
    modelValue: (m) => m.tokens,
    runnerValue: (r) => r.tokens,
  },
};
