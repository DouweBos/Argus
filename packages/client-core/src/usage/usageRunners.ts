/**
 * The usage summary split by runner: the "By runner" rows and the chart's
 * stacked series. Shared by the web client's `usageSummaryView` and mirrored
 * by the native apps.
 */

import type { MetricView } from "./summaryMetric";
import type {
  ClaudeUsageSummary,
  UsageModelRow,
  UsageRunnerRow,
} from "@argus/remote-protocol";
import { formatShare, formatTokens, formatUsd } from "./usageFormat";

/** Categorical hues the chart has; any more runners fold into "Other runners". */
export const MAX_CHART_SERIES = 4;

export interface UsageRunnerView {
  id: string;
  label: string;
  /** "12 sessions". */
  sessions: string;
  /** "$12.40", or "—" for a runner with no price. */
  cost: string;
  share: string;
  tokens: string;
  /** Its share of the headline total, 0–1. */
  progress: number;
  priced: boolean;
}

/** One stacked layer of the chart, lined up with its labels. */
export interface UsageChartSeries {
  label: string;
  values: number[];
  /** The folded remainder, drawn in the neutral colour. */
  other: boolean;
}

export function sessionCount(count: number): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? "session" : "sessions"}`;
}

/** Largest first, values that can't be measured (an unpriced cost) last. */
function byValue<T>(rows: T[], value: (row: T) => number | null): T[] {
  return [...rows].sort((a, b) => (value(b) ?? -1) - (value(a) ?? -1));
}

export function usageRunnerViews(
  runners: UsageRunnerRow[],
  view: MetricView,
  total: number,
): UsageRunnerView[] {
  return byValue(runners, view.runnerValue).map((r) => {
    const value = view.runnerValue(r);

    return {
      id: r.runner,
      label: r.label,
      sessions: sessionCount(r.sessions),
      cost: r.priced ? formatUsd(r.cost_usd) : "—",
      share: value === null ? "—" : formatShare(value, total),
      tokens: formatTokens(r.tokens),
      progress: value !== null && total > 0 ? value / total : 0,
      priced: r.priced,
    };
  });
}

/**
 * The chart's layers, largest at the bottom, when two or more runners have
 * something to draw; null keeps the single-series chart.
 */
export function usageChartSeries(
  data: ClaudeUsageSummary,
  view: MetricView,
): UsageChartSeries[] | null {
  const length = data.series.length;
  const layers = (data.runners ?? [])
    .map((r) => {
      const values = Array.from({ length }, (_, i) => {
        const point = r.series[i];

        return point ? view.point(point) : 0;
      });

      return {
        label: r.label,
        values,
        total: values.reduce((a, b) => a + b, 0),
      };
    })
    .filter((l) => l.total > 0)
    .sort((a, b) => b.total - a.total);
  if (layers.length < 2) {
    return null;
  }
  const shown = layers.slice(0, MAX_CHART_SERIES);
  const rest = layers.slice(MAX_CHART_SERIES);
  const series = shown.map((l) => ({
    label: l.label,
    values: l.values,
    other: false,
  }));
  if (rest.length > 0) {
    series.push({
      label: "Other runners",
      values: Array.from({ length }, (_, i) =>
        rest.reduce((sum, l) => sum + (l.values[i] ?? 0), 0),
      ),
      other: true,
    });
  }

  return series;
}

/** "opus · Codex" once there's more than one runner to tell apart. */
export function modelLabel(
  model: UsageModelRow,
  runners: UsageRunnerRow[] | undefined,
): string {
  if (!model.runner || (runners?.length ?? 0) < 2) {
    return model.model;
  }
  const runner = runners?.find((r) => r.runner === model.runner);

  return `${model.model} · ${runner?.label ?? model.runner}`;
}
