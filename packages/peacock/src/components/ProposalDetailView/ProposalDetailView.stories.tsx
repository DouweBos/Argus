import type { Meta, StoryObj } from "@storybook/react";
import { ProposalCard } from "../ProposalCard/ProposalCard";
import { ProposalDetailView } from "./ProposalDetailView";

const noop = () => undefined;

const meta: Meta<typeof ProposalDetailView> = {
  title: "Automations/ProposalDetailView",
  component: ProposalDetailView,
  tags: ["autodocs"],
  args: {
    onBack: noop,
    links: [
      { label: "Morning triage — this run", onClick: noop },
      { label: "The automation", onClick: noop },
    ],
  },
};
export default meta;
type Story = StoryObj<typeof ProposalDetailView>;

export const Pending: Story = {
  args: {
    card: (
      <ProposalCard
        confidence={0.86}
        primary={{ kind: "start", label: "Start", onClick: noop }}
        rationale="Three reports this week, and the fix is small."
        summary="Opening a session whose worktree was removed on disk throws."
        title="Fix the crash when opening a deleted worktree"
        onDismiss={noop}
        onRequestRevision={noop}
        onResolve={noop}
        onStartWithNote={noop}
      />
    ),
  },
};

export const Decided: Story = {
  args: {
    card: (
      <ProposalCard
        confidence={0.6}
        decided="You dismissed this: not worth the churn."
        summary="Rename the settings store to match the others."
        title="Rename the settings store"
        onDismiss={noop}
      />
    ),
  },
};

export const Gone: Story = { args: { card: null, links: [] } };

export const Loading: Story = {
  args: { card: null, loading: true, links: [] },
};
