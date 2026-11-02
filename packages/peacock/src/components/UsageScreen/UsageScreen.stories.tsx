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
      model: "claude-opus-4-5",
      cost: "$380.10",
      share: "92.1%",
      tokens: "390M",
      progress: 0.921,
      priced: true,
    },
    {
      model: "claude-haiku-4-5",
      cost: "$32.70",
      share: "7.9%",
      tokens: "22.0M",
      progress: 0.079,
      priced: true,
    },
    {
      model: "local-model",
      cost: "—",
      share: "—",
      tokens: "41.2K",
      progress: 0,
      priced: false,
    },
  ],
  hasUnpriced: true,
};

const meta: Meta<typeof UsageScreen> = {
  title: "Screens/UsageScreen",
  component: UsageScreen,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Plan limits per Claude account (bars fill with the share used) and cost or tokens over a range. Rows come from `usageAccountViews` / `usageSummaryView` in `@argus/client-core`; the desktop and the web client each fetch them.",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof UsageScreen>;

function Interactive({ accounts }: { accounts: UsageAccountData[] | null }) {
  const [tab, setTab] = useState<UsageScreenTab>("limits");
  const [range, setRange] = useState<UsageScreenRange>("30d");
  const retry = { onRetry: () => {}, retrying: false };

  return (
    <UsageScreen
      plan={accounts?.length === 1 ? accounts[0].plan : null}
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
          {...retry}
        />
      ) : (
        <UsageSummaryPanel
          error={null}
          loading={false}
          summary={summary}
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
