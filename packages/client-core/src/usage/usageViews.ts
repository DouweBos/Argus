/**
 * The usage screen's rows, ready to render: each Claude account's and each
 * runner's plan windows as meters and a summary keyed on cost or tokens. Peacock's usage panels take
 * these shapes; the desktop, the Mac's `UsageView` and the web client agree
 * on them.
 */

import type {
  ClaudeAccountLimits,
  ClaudeUsageLimits,
  ClaudeUsageSummary,
  RunnerUsageLimits,
  UsageLimitWindow,
} from "@argus/remote-protocol";
import { METRICS, type SummaryMetric } from "./summaryMetric";
import {
  bucketLabel,
  formatShare,
  formatTokens,
  formatUsd,
  limitTone,
  paceLabel,
  percentLeft,
  resetHint,
  type UsageLimitTone,
} from "./usageFormat";
import {
  modelLabel,
  sessionCount,
  usageChartSeries,
  usageRunnerViews,
  type UsageChartSeries,
  type UsageRunnerView,
} from "./usageRunners";

/** One plan window. The bar fills with the share used: full means spent. */
export interface UsageWindowView {
  id: string;
  label: string;
  /** "73% left". */
  value: string;
  /** Used share, 0–1. */
  progress: number;
  tone: UsageLimitTone;
  hint: string | null;
  aside: string | null;
}

/**
 * `unsupported`: API key or Console sign-in, no plan limits. `none`: the plan
 * reports no windows. `failed`: Claude didn't answer and nothing older shows.
 */
export type UsageAccountState = "failed" | "none" | "ok" | "unsupported";

export interface UsageAccountView {
  id: string;
  label: string;
  plan: string | null;
  state: UsageAccountState;
  /** The windows are the last known values: the latest check failed. */
  stale: boolean;
  /** Why there are no windows, in the runner's words; null keeps Claude's copy. */
  message: string | null;
  windows: UsageWindowView[];
}

export function usageWindowViews(
  source: { windows: UsageLimitWindow[] },
  now: number,
): UsageWindowView[] {
  return source.windows.map((w) => ({
    id: w.id,
    label: w.label,
    value: `${String(percentLeft(w.used_percent))}% left`,
    progress: Math.min(1, Math.max(0, w.used_percent / 100)),
    tone: limitTone(w),
    hint: resetHint(w.resets_at, now),
    aside: paceLabel(w.pace),
  }));
}

function limitState(
  limits: ClaudeAccountLimits | RunnerUsageLimits,
): UsageAccountState {
  if (limits.status === "unsupported") {
    return "unsupported";
  }
  if (limits.windows.length === 0) {
    return limits.status === "failed" ? "failed" : "none";
  }

  return "ok";
}

export function usageAccountViews(
  limits: ClaudeUsageLimits,
  now: number,
): UsageAccountView[] {
  return limits.accounts.map((account) => {
    const state = limitState(account);

    return {
      id: account.account_id,
      label: account.label,
      plan: account.subscription_type,
      state,
      stale: state === "ok" && account.status === "failed",
      message: null,
      windows: state === "ok" ? usageWindowViews(account, now) : [],
    };
  });
}

function runnerMessage(
  runner: RunnerUsageLimits,
  state: UsageAccountState,
): string | null {
  switch (state) {
    case "unsupported":
      return runner.message ?? "No plan limits";
    case "failed":
      return (
        runner.message ?? `${runner.label} didn't answer the limits check.`
      );
    case "none":
      return runner.message;
    case "ok":
      return null;
  }
}

/** Codex, Cursor, Grok and the like: one group each, after the Claude accounts. */
export function usageRunnerLimitViews(
  limits: ClaudeUsageLimits,
  now: number,
): UsageAccountView[] {
  return (limits.runners ?? []).map((runner) => {
    const state = limitState(runner);

    return {
      id: runner.runner,
      label: runner.label,
      plan: runner.plan,
      state,
      stale: state === "ok" && runner.status === "failed",
      message: runnerMessage(runner, state),
      windows: state === "ok" ? usageWindowViews(runner, now) : [],
    };
  });
}

/** The plan to name in the header: only when one Claude account is all there is. */
export function usagePlan(limits: ClaudeUsageLimits | null): string | null {
  return limits?.accounts.length === 1 && !limits.runners?.length
    ? (limits.accounts[0]?.subscription_type ?? null)
    : null;
}

export interface UsageModelView {
  /** The same model can show once per runner. */
  id: string;
  /** "opus", or "opus · Codex" when several runners show. */
  model: string;
  /** "$12.40", or "—" for a model the price list doesn't cover. */
  cost: string;
  share: string;
  tokens: string;
  /** Its share of the headline total, 0–1. */
  progress: number;
  priced: boolean;
}

export interface UsageSummaryView {
  /** No agent sessions in the range. */
  empty: boolean;
  headline: string;
  /** "12 sessions · API estimate". */
  caption: string;
  /** Costs read $0 until the host has the price list. */
  pricesPending: boolean;
  chart: {
    caption: string;
    labels: string[];
    values: number[];
    kind: "bar" | "line";
    formatValue: (value: number) => string;
    /** Stacked by runner when two or more have something to draw. */
    series: UsageChartSeries[] | null;
  };
  totals: { label: string; value: string }[];
  parts: {
    caption: string;
    segments: {
      label: string;
      value: number;
      display: string;
      detail: string;
      other?: boolean;
    }[];
  };
  /** Largest first; empty from hosts that predate runners. */
  runners: UsageRunnerView[];
  /** Largest first. */
  models: UsageModelView[];
  /** Some model has no price: say what the dashes mean. */
  hasUnpriced: boolean;
}

export function usageSummaryView(
  data: ClaudeUsageSummary,
  metric: SummaryMetric,
): UsageSummaryView {
  const view = METRICS[metric];
  const total = metric === "cost" ? data.cost.total : data.tokens.processed;
  const values = data.series.map(view.point);
  const models = [...data.models].sort(
    (a, b) => (view.modelValue(b) ?? -1) - (view.modelValue(a) ?? -1),
  );
  const sessions = sessionCount(data.sessions);

  return {
    empty: data.sessions === 0,
    headline: view.headline(data),
    caption: `${sessions}${metric === "cost" ? " · API estimate" : " · processed tokens"}`,
    pricesPending: metric === "cost" && data.prices_fetched_at === null,
    chart: {
      caption: view.chartTitle(data.bucket),
      labels: data.series.map((p) => bucketLabel(p.start, data.bucket)),
      values,
      kind: values.length > 31 ? "line" : "bar",
      formatValue: view.axis,
      series: usageChartSeries(data, view),
    },
    totals: [
      { label: "Processed tokens", value: formatTokens(data.tokens.processed) },
      { label: "Cached input", value: formatTokens(data.tokens.cache_read) },
      { label: "Uncached input", value: formatTokens(data.tokens.input) },
      { label: "Output", value: formatTokens(data.tokens.output) },
      { label: "Cache savings", value: formatUsd(data.cache_savings_usd) },
    ],
    parts: {
      caption: view.partsTitle,
      segments: view.parts(data).map((p) => ({
        ...p,
        display: view.format(p.value),
        detail: formatShare(p.value, total),
      })),
    },
    runners: usageRunnerViews(data.runners ?? [], view, total),
    models: models.map((m) => {
      const value = view.modelValue(m);

      return {
        id: `${m.runner ?? ""}:${m.model}`,
        model: modelLabel(m, data.runners),
        cost: m.priced ? formatUsd(m.cost_usd) : "—",
        share: value === null ? "—" : formatShare(value, total),
        tokens: formatTokens(m.tokens),
        progress: value !== null && total > 0 ? value / total : 0,
        priced: m.priced,
      };
    }),
    hasUnpriced: models.some((m) => !m.priced),
  };
}
