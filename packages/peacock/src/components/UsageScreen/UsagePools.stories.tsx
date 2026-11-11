import type { UsageAccountData } from "./UsageAccountWindows";
import type { UsagePoolData } from "./UsagePoolSection";
import type { Meta, StoryObj } from "@storybook/react";
import type { ReactNode } from "react";
import { UsageLimitsPanel } from "./UsageLimitsPanel";
import { UsageModelDetail } from "./UsageModelDetail";
import { UsageScreen } from "./UsageScreen";
import { type UsageSummaryData, UsageSummaryPanel } from "./UsageSummaryPanel";

const noop = () => {};

function account(
  id: string,
  plan: string,
  session: number,
  weekly: number | null,
): UsageAccountData {
  const left = (used: number) => `${String(100 - used)}% left`;

  return {
    id,
    label: id,
    plan,
    state: "ok",
    stale: false,
    windows: [
      {
        id: "five_hour",
        label: "Session",
        value: left(session),
        progress: session / 100,
        tone: session >= 90 ? "danger" : "accent",
        hint: "Resets in 1h 12m",
        aside: null,
      },
      ...(weekly === null
        ? []
        : [
            {
              id: "seven_day",
              label: "Weekly",
              value: left(weekly),
              progress: weekly / 100,
              tone: weekly >= 90 ? ("danger" as const) : ("accent" as const),
              hint: "Resets in 3d 4h",
              aside: null,
            },
          ]),
    ],
  };
}

const accounts: UsageAccountData[] = [
  account("Work", "max", 93, 100),
  account("Home", "pro", 30, 45),
  account("Side project", "pro", 15, null),
  {
    id: "Console",
    label: "Console",
    plan: null,
    state: "unsupported",
    stale: false,
    windows: [],
  },
];

const segment = (
  id: string,
  plan: string,
  used: number,
  over: Partial<UsagePoolData["segments"][number]> = {},
) => ({
  accountId: id,
  label: id,
  plan,
  present: true,
  used,
  restoring: false,
  resetHint: null,
  detail: `${id} · ${plan} · ${String(Math.round((1 - used) * 100))}% left`,
  ...over,
});

const pools: UsagePoolData[] = [
  {
    id: "five_hour",
    label: "Session",
    value: "52% left",
    progress: 0.48,
    tone: "accent",
    next: "Work resets in 3d 4h, giving back 33% of the pool",
    segments: [
      // Weekly spent: no session left until the week resets.
      segment("Work", "max", 1, {
        restoring: true,
        resetHint: "Resets in 3d 4h",
      }),
      segment("Home", "pro", 0.3, { resetHint: "Resets in 3h" }),
      segment("Side project", "pro", 0.15),
    ],
  },
  {
    id: "seven_day",
    label: "Weekly",
    value: "28% left",
    progress: 0.72,
    tone: "warning",
    next: "Work resets in 3d 4h, giving back 50% of the pool",
    segments: [
      segment("Work", "max", 1, { restoring: true }),
      segment("Home", "pro", 0.45),
      segment("Side project", "pro", 0, {
        present: false,
        detail: "Side project · pro · No such limit",
      }),
    ],
  },
];

const meta: Meta = {
  title: "Screens/UsageScreen/Pools and details",
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj;

function Frame({
  children,
  tab,
}: {
  children: ReactNode;
  tab: "cost" | "limits" | "tokens";
}) {
  return (
    <div style={{ height: 760, display: "flex" }}>
      <UsageScreen
        onPrices={noop}
        onRangeChange={noop}
        onRefresh={noop}
        onTabChange={noop}
        range="30d"
        refreshing={false}
        tab={tab}
      >
        {children}
      </UsageScreen>
    </div>
  );
}

/** Three Claude accounts pooled, one with its weekly cap spent; Codex beside them. */
export const PooledLimits: Story = {
  render: () => (
    <Frame tab="limits">
      <UsageLimitsPanel
        accounts={accounts}
        error={null}
        loading={false}
        pools={pools}
        retrying={false}
        runners={[account("Codex", "plus", 29, 56)]}
        onRetry={noop}
      />
    </Frame>
  ),
};

const speedSummary: UsageSummaryData = {
  empty: false,
  headline: "$512.40",
  caption:
    "44 sessions · estimated at API prices where agents don’t report their own",
  pricesPending: false,
  chart: {
    caption: "Daily cost",
    labels: ["Oct 1", "Oct 2", "Oct 3", "Oct 4", "Oct 5"],
    values: [80, 120, 95, 140, 77],
    kind: "bar",
    formatValue: (v) => `$${String(Math.round(v))}`,
    series: null,
  },
  totals: [
    { label: "Processed tokens", value: "498M" },
    { label: "Cached input", value: "450M" },
    { label: "Uncached input", value: "14.2M" },
    { label: "Output", value: "4.10M" },
    { label: "Cache savings", value: "$1,320.00" },
    { label: "Premium", value: "$96.20" },
  ],
  parts: {
    caption: "Cost by type",
    segments: [
      { label: "Input", value: 70, display: "$70.00", detail: "13.7%" },
      { label: "Cache read", value: 140, display: "$140.00", detail: "27.3%" },
      { label: "Cache write", value: 190, display: "$190.00", detail: "37.1%" },
      { label: "Output", value: 112.4, display: "$112.40", detail: "21.9%" },
    ],
  },
  runners: [],
  models: [
    {
      id: "claude-code:claude-opus-4-5",
      model: "claude-opus-4-5",
      cost: "$470.10",
      share: "91.7%",
      tokens: "460M",
      progress: 0.917,
      priced: true,
    },
    {
      id: "claude-code:local-model",
      model: "local-model",
      cost: "—",
      share: "—",
      tokens: "41.2K",
      progress: 0,
      priced: false,
    },
  ],
  hasUnpriced: true,
  speeds: [
    {
      id: "standard",
      label: "Standard",
      premium: null,
      cost: "$320.00",
      share: "62.5%",
      tokens: "380M",
      progress: 0.625,
    },
    {
      id: "fast",
      label: "Fast",
      premium: "+$96.20 premium",
      cost: "$192.40",
      share: "37.5%",
      tokens: "118M",
      progress: 0.375,
    },
  ],
};

/** Fast-mode requests: a Premium total and a By speed breakdown; model rows open their detail. */
export const SpeedSplit: Story = {
  render: () => (
    <Frame tab="cost">
      <UsageSummaryPanel
        error={null}
        loading={false}
        retrying={false}
        summary={speedSummary}
        onModelSelect={noop}
        onRetry={noop}
      />
    </Frame>
  ),
};

export const ModelDetail: Story = {
  render: () => (
    <Frame tab="cost">
      <UsageModelDetail
        detail={{
          title: "claude-opus-4-5",
          runner: "Claude Code",
          headline: "$470.10",
          caption: "91.7% of the range",
          unpriced: false,
          chart: {
            caption: "Daily cost",
            labels: ["Oct 1", "Oct 2", "Oct 3", "Oct 4", "Oct 5"],
            values: [72, 110, 88, 131, 69],
            kind: "bar",
            formatValue: (v) => `$${String(Math.round(v))}`,
          },
          stats: [
            { label: "Cost", value: "$470.10" },
            { label: "Tokens", value: "460M" },
            { label: "Cache hit rate", value: "91%" },
            { label: "Per million tokens", value: "$1.02" },
            { label: "Price", value: "Your price" },
          ],
          mappedFrom: ["claude-opus-preview", "opus-internal-eval"],
        }}
        loading={false}
        onBack={noop}
        onSetPrice={noop}
      />
    </Frame>
  ),
};

export const UnpricedModel: Story = {
  render: () => (
    <Frame tab="tokens">
      <UsageModelDetail
        detail={{
          title: "local-model",
          runner: "OpenCode",
          headline: "41.2K",
          caption: "<0.1% of the range",
          unpriced: true,
          chart: {
            caption: "Daily processed tokens",
            labels: ["Oct 1", "Oct 2", "Oct 3"],
            values: [12000, 20000, 9200],
            kind: "bar",
            formatValue: (v) => `${String(Math.round(v / 1000))}K`,
          },
          stats: [
            { label: "Cost", value: "—" },
            { label: "Tokens", value: "41.2K" },
            { label: "Cache hit rate", value: "—" },
            { label: "Per million tokens", value: "—" },
            { label: "Price", value: "No price" },
          ],
          mappedFrom: [],
        }}
        loading={false}
        onBack={noop}
        onSetPrice={noop}
      />
    </Frame>
  ),
};

export const ModelMissing: Story = {
  render: () => (
    <Frame tab="cost">
      <UsageModelDetail detail={null} loading={false} onBack={noop} />
    </Frame>
  ),
};
