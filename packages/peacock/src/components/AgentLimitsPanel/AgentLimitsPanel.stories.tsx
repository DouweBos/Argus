import type { Meta, StoryObj } from "@storybook/react";
import { AgentLimitsPanel } from "./AgentLimitsPanel";

const noop = () => {};

const meta: Meta<typeof AgentLimitsPanel> = {
  title: "Chat/AgentLimitsPanel",
  component: AgentLimitsPanel,
  args: { loading: false, error: null, onDismiss: noop, onOpenUsage: noop },
  render: (args) => (
    <div style={{ width: 520 }}>
      <AgentLimitsPanel {...args} />
    </div>
  ),
};
export default meta;
type Story = StoryObj<typeof AgentLimitsPanel>;

export const Codex: Story = {
  args: {
    title: "Codex",
    pools: null,
    accounts: [
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
            value: "72% left",
            progress: 0.28,
            tone: "accent",
            hint: "Resets in 3h 10m",
            aside: null,
          },
          {
            id: "secondary",
            label: "Weekly",
            value: "18% left",
            progress: 0.82,
            tone: "warning",
            hint: "Resets in 2d 6h",
            aside: "Ahead of pace",
          },
        ],
      },
    ],
  },
};

export const PooledClaude: Story = {
  args: {
    title: "Claude Code",
    accounts: [],
    pools: [
      {
        id: "five_hour",
        label: "Session",
        value: "54% left",
        progress: 0.46,
        tone: "accent",
        next: "Work resets in 1h 12m, giving back 31% of the pool",
        segments: [
          {
            accountId: "work",
            label: "Work",
            plan: "max",
            present: true,
            used: 0.93,
            restoring: true,
            resetHint: "Resets in 1h 12m",
            detail: "Work · max · 7% left · Resets in 1h 12m",
          },
          {
            accountId: "home",
            label: "Home",
            plan: "pro",
            present: true,
            used: 0.3,
            restoring: false,
            resetHint: "Resets in 3h",
            detail: "Home · pro · 70% left · Resets in 3h",
          },
          {
            accountId: "side",
            label: "Side",
            plan: "pro",
            present: true,
            used: 0.15,
            restoring: false,
            resetHint: null,
            detail: "Side · pro · 85% left",
          },
        ],
      },
    ],
  },
};

export const Loading: Story = {
  args: { title: "Claude Code", pools: null, accounts: [], loading: true },
};

export const Failed: Story = {
  args: {
    title: "Cursor",
    pools: null,
    accounts: [],
    error: "The computer didn't answer.",
  },
};
