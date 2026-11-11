import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { type UsageAccountData, UsageLimitsPanel } from "./UsageLimitsPanel";
import {
  type UsageScreenRange,
  type UsageScreenTab,
  UsageScreen,
} from "./UsageScreen";
import { type UsageSummaryData, UsageSummaryPanel } from "./UsageSummaryPanel";

const work: UsageAccountData = {
  id: "work",
  label: "Work",
  plan: "max",
  state: "ok",
  stale: false,
  windows: [
    {
      id: "five_hour",
      label: "Session",
      value: "38% left",
      progress: 0.62,
      tone: "accent",
      hint: "Resets in 2h 13m",
      aside: "On pace",
    },
    {
      id: "seven_day",
      label: "Weekly",
      value: "9% left",
      progress: 0.91,
      tone: "danger",
      hint: "Resets in 3d 4h",
      aside: "Ahead of pace",
    },
    {
      id: "seven_day_opus",
      label: "Weekly · Opus",
      value: "0% left",
      progress: 1,
      tone: "danger",
      hint: "Resets in 3d 4h",
      aside: null,
    },
  ],
};

const usd = (v: number) => `$${String(Math.round(v))}`;

const summary: UsageSummaryData = {
  empty: false,
  headline: "$412.80",
  caption: "38 sessions · API estimate",
  pricesPending: false,
  chart: {
    caption: "Daily cost",
    labels: ["Oct 1", "Oct 2", "Oct 3", "Oct 4", "Oct 5", "Oct 6", "Oct 7"],
    values: [40, 72, 18, 95, 61, 80, 46],
    kind: "bar",
    formatValue: usd,
    series: null,
  },
  totals: [
    { label: "Processed tokens", value: "412M" },
    { label: "Cached input", value: "380M" },
    { label: "Uncached input", value: "12.4M" },
    { label: "Output", value: "3.10M" },
    { label: "Cache savings", value: "$1,140.22" },
  ],
  parts: {
    caption: "Cost by type",
    segments: [
      { label: "Input", value: 60, display: "$60.00", detail: "14.5%" },
      { label: "Cache read", value: 114, display: "$114.00", detail: "27.6%" },
      { label: "Cache write", value: 160, display: "$160.00", detail: "38.8%" },
      { label: "Output", value: 78.8, display: "$78.80", detail: "19.1%" },
    ],
  },
  models: [
    {
      id: "opus",
      model: "claude-opus-4-5",
      cost: "$380.10",
      share: "92.1%",
      tokens: "390M",
      progress: 0.921,
      priced: true,
    },
    {
      id: "haiku",
      model: "claude-haiku-4-5",
      cost: "$32.70",
      share: "7.9%",
      tokens: "22.0M",
      progress: 0.079,
      priced: true,
    },
    {
      id: "local",
      model: "local-model",
      cost: "—",
      share: "—",
      tokens: "41.2K",
      progress: 0,
      priced: false,
    },
  ],
  runners: [],
  hasUnpriced: true,
};

const multiRunner: UsageSummaryData = {
  ...summary,
  headline: "$498.30",
  caption: "61 sessions · API estimate",
  chart: {
    ...summary.chart,
    series: [
      { label: "Claude Code", values: [40, 72, 18, 95, 61, 80, 46] },
      { label: "Codex", values: [12, 8, 30, 14, 22, 0, 18] },
      { label: "Gemini", values: [0, 4, 6, 2, 9, 12, 3] },
    ],
  },
  parts: {
    caption: "Cost by type",
    segments: [
      ...summary.parts.segments,
      {
        label: "Other",
        value: 9.4,
        display: "$9.40",
        detail: "1.9%",
        other: true,
      },
    ],
  },
  runners: [
    {
      id: "claude",
      label: "Claude Code",
      sessions: "38 sessions",
      cost: "$412.80",
      share: "82.8%",
      tokens: "412M",
      progress: 0.828,
      priced: true,
    },
    {
      id: "codex",
      label: "Codex",
      sessions: "17 sessions",
      cost: "$76.10",
      share: "15.3%",
      tokens: "88.0M",
      progress: 0.153,
      priced: true,
    },
    {
      id: "gemini",
      label: "Gemini",
      sessions: "5 sessions",
      cost: "$9.40",
      share: "1.9%",
      tokens: "6.20M",
      progress: 0.019,
      priced: true,
    },
    {
      id: "opencode",
      label: "OpenCode",
      sessions: "1 session",
      cost: "—",
      share: "—",
      tokens: "41.2K",
      progress: 0,
      priced: false,
    },
  ],
  models: [
    { ...summary.models[0], model: "claude-opus-4-5 · Claude Code" },
    {
      id: "codex:gpt-5-codex",
      model: "gpt-5-codex · Codex",
      cost: "$76.10",
      share: "15.3%",
      tokens: "88.0M",
      progress: 0.153,
      priced: true,
    },
    { ...summary.models[1], model: "claude-haiku-4-5 · Claude Code" },
    {
      id: "gemini:gemini-2.5-pro",
      model: "gemini-2.5-pro · Gemini",
      cost: "$9.40",
      share: "1.9%",
      tokens: "6.20M",
      progress: 0.019,
      priced: true,
    },
    { ...summary.models[2], model: "local-model · OpenCode" },
  ],
};

const runnerLimits: UsageAccountData[] = [
  {
    id: "codex",
    label: "Codex",
    plan: "plus",
    state: "ok",
    stale: false,
    windows: [
      {
        id: "primary",
        label: "5-hour",
        value: "71% left",
        progress: 0.29,
        tone: "accent",
        hint: "Resets in 3h 2m",
        aside: "Under pace",
      },
      {
        id: "secondary",
        label: "Weekly",
        value: "44% left",
        progress: 0.56,
        tone: "accent",
        hint: "Resets in 4d 1h",
        aside: "On pace",
      },
    ],
  },
  {
    id: "cursor",
    label: "Cursor",
    plan: null,
    state: "failed",
    stale: false,
    message: "Cursor didn't answer the limits check.",
    windows: [],
  },
  {
    id: "grok",
    label: "Grok",
    plan: null,
    state: "unsupported",
    stale: false,
    message: "Signed in with an API key: no plan limits.",
    windows: [],
  },
];

const meta: Meta<typeof UsageScreen> = {
  title: "Screens/UsageScreen",
  component: UsageScreen,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Plan limits per Claude account and per runner (bars fill with the share used) and cost or tokens over a range, split by runner. Rows come from `usageAccountViews` / `usageRunnerLimitViews` / `usageSummaryView` in `@argus/client-core`; the desktop and the web client each fetch them.",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof UsageScreen>;

function Interactive({
  accounts,
  runners = [],
  data = summary,
}: {
  accounts: UsageAccountData[] | null;
  runners?: UsageAccountData[];
  data?: UsageSummaryData;
}) {
  const [tab, setTab] = useState<UsageScreenTab>("limits");
  const [range, setRange] = useState<UsageScreenRange>("30d");
  const retry = { onRetry: () => {}, retrying: false };

  return (
    <UsageScreen
      plan={
        accounts?.length === 1 && runners.length === 0 ? accounts[0].plan : null
      }
      range={range}
      refreshing={false}
      tab={tab}
      onRangeChange={setRange}
      onRefresh={() => {}}
      onTabChange={setTab}
    >
      {tab === "limits" ? (
        <UsageLimitsPanel
          accounts={accounts}
          error={null}
          loading={false}
          runners={runners}
          {...retry}
        />
      ) : (
        <UsageSummaryPanel
          error={null}
          loading={false}
          summary={data}
          {...retry}
        />
      )}
    </UsageScreen>
  );
}

export const OneAccount: Story = {
  render: () => <Interactive accounts={[work]} />,
};

export const SeveralAccounts: Story = {
  render: () => (
    <Interactive
      accounts={[
        work,
        {
          ...work,
          id: "home",
          label: "Home",
          plan: "pro",
          stale: true,
          windows: work.windows.slice(0, 1),
        },
        {
          id: "api",
          label: "API key",
          plan: null,
          state: "unsupported",
          stale: false,
          windows: [],
        },
      ]}
    />
  ),
};

export const SeveralRunners: Story = {
  render: () => (
    <Interactive accounts={[work]} data={multiRunner} runners={runnerLimits} />
  ),
};

export const RunnersOnly: Story = {
  render: () => <Interactive accounts={[]} runners={runnerLimits} />,
};

export const MultiRunnerSummary: Story = {
  render: () => (
    <UsageSummaryPanel
      error={null}
      loading={false}
      retrying={false}
      summary={multiRunner}
      onRetry={() => {}}
    />
  ),
};

export const NoAccount: Story = {
  render: () => <Interactive accounts={[]} />,
};

export const LimitsLoading: Story = {
  render: () => (
    <UsageLimitsPanel
      accounts={null}
      error={null}
      loading
      retrying={false}
      onRetry={() => {}}
    />
  ),
};

export const LimitsFailed: Story = {
  render: () => (
    <UsageLimitsPanel
      accounts={null}
      error="The computer didn't answer in time."
      loading={false}
      retrying={false}
      onRetry={() => {}}
    />
  ),
};

export const SummaryEmpty: Story = {
  render: () => (
    <UsageSummaryPanel
      error={null}
      loading={false}
      retrying={false}
      summary={{ ...summary, empty: true }}
      onRetry={() => {}}
    />
  ),
};

export const SummaryLoading: Story = {
  render: () => (
    <UsageSummaryPanel
      error={null}
      loading
      retrying={false}
      summary={null}
      onRetry={() => {}}
    />
  ),
};
