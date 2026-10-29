import type { LimitHandoffAccount } from "@argus/remote-protocol";
import type { Meta, StoryObj } from "@storybook/react";
import { LimitHandoffCard } from "./LimitHandoffCard";

const NOW = new Date("2026-10-03T12:00:00");

const work: LimitHandoffAccount = {
  account_id: "work",
  label: "Work",
  detail: "dana@example.com",
  usage: {
    id: "weekly",
    kind: "weekly",
    label: "Weekly",
    used_percent: 42,
    resets_at: new Date("2026-10-06T09:00:00").getTime(),
    window_minutes: 10_080,
    pace: "under",
  },
};

const side: LimitHandoffAccount = {
  account_id: "side",
  label: "dana@side.example",
  detail: "pro",
  usage: {
    id: "session",
    kind: "session",
    label: "Session",
    used_percent: 8,
    resets_at: new Date("2026-10-03T15:30:00").getTime(),
    window_minutes: 300,
    pace: "under",
  },
};

const unknown: LimitHandoffAccount = {
  account_id: "team",
  label: "Team plan",
  detail: null,
  usage: null,
};

const meta: Meta<typeof LimitHandoffCard> = {
  title: "Components/LimitHandoffCard",
  component: LimitHandoffCard,
  parameters: { layout: "padded" },
  args: { now: NOW, onHandoff: () => {} },
};

export default meta;

type Story = StoryObj<typeof LimitHandoffCard>;

export const OneAccount: Story = { args: { accounts: [work] } };

export const SeveralAccounts: Story = {
  args: { accounts: [work, side, unknown] },
};

export const UsageUnknown: Story = { args: { accounts: [unknown] } };

export const HandingOff: Story = {
  args: { accounts: [work, side], pendingId: "work" },
};

export const Failed: Story = {
  args: {
    accounts: [work, side],
    error: "The agent couldn't move to that account.",
  },
};

export const ReadOnly: Story = {
  args: { accounts: [work, side], onHandoff: undefined },
};
