import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../Button/Button";
import { ProposalCard } from "../ProposalCard/ProposalCard";
import { InboxView } from "./InboxView";

const noop = () => undefined;

const CARD = (
  <ProposalCard
    confidence={0.86}
    primary={{ kind: "start", label: "Start", onClick: noop }}
    rationale="Three reports this week, and the fix is small."
    sourceLabel="argus#412"
    summary="Opening a session whose worktree was removed on disk throws."
    title="Fix the crash when opening a deleted worktree"
    onDismiss={noop}
    onResolve={noop}
    onStartWithNote={noop}
  />
);

const meta: Meta<typeof InboxView> = {
  title: "Automations/InboxView",
  component: InboxView,
  tags: ["autodocs"],
  args: {
    header: true,
    emptyBody:
      "Your automations have nothing waiting on you. This is what a quiet inbox looks like.",
    emptyAction: <Button size="sm">Automations</Button>,
    decide: null,
    pendingCount: 0,
    reports: [],
    started: [],
    failed: [],
    cleared: [],
  },
};
export default meta;
type Story = StoryObj<typeof InboxView>;

export const Full: Story = {
  args: {
    phase: { kind: "content" },
    decide: CARD,
    pendingCount: 1,
    reports: [
      {
        id: "r1",
        title: "Weekly summary",
        subtitle: "Shipped the inbox, fixed two crashes",
        when: "2h ago",
        onOpen: noop,
        onDismiss: noop,
      },
    ],
    started: [
      {
        id: "p2",
        title: "Bump the flaky simulator timeout",
        subtitle: "Argus",
        badge: { label: "auto-started", tone: "neutral" },
        onOpen: noop,
      },
    ],
    failed: [
      {
        id: "r2",
        title: "Morning triage",
        subtitle: "gh: not authenticated",
        when: "5h ago",
        onOpen: noop,
        onDismiss: noop,
      },
    ],
    cleared: [
      {
        id: "p3",
        title: "Rename the settings store",
        subtitle: "The PR it asked for merged · Morning triage · 1h ago",
        badge: "withdrawn",
        onOpen: noop,
      },
    ],
  },
};

export const RefreshFailed: Story = {
  args: {
    ...Full.args,
    error: "Couldn't read the inbox — The computer didn't answer in time.",
  },
};

export const Empty: Story = { args: { phase: { kind: "empty" } } };

export const Loading: Story = { args: { phase: { kind: "loading" } } };

export const Failed: Story = {
  args: {
    phase: { kind: "failed", error: "Not connected to a computer." },
    onRetry: noop,
  },
};
