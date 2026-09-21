import type { Meta, StoryObj } from "@storybook/react";
import { Badge } from "../Badge/Badge";
import { ProposalCard } from "./ProposalCard";

const meta: Meta<typeof ProposalCard> = {
  title: "Primitives/ProposalCard",
  component: ProposalCard,
  tags: ["autodocs"],
  args: {
    title: "Fix the crash when opening a deleted worktree",
    summary:
      "argus#412 reproduces every time: the sidebar reads the worktree path after it was removed on disk.",
    rationale: "Two-line fix, the failing path is already covered by a test.",
    confidence: 0.9,
    sourceLabel: "argus#412",
    primary: { kind: "start", label: "Start", onClick: () => undefined },
    onDismiss: () => undefined,
    onOpenSource: () => undefined,
    meta: (
      <>
        <Badge tone="neutral">Argus</Badge>
        <Badge tone="accent">start session</Badge>
      </>
    ),
  },
};
export default meta;
type Story = StoryObj<typeof ProposalCard>;

export const Confident: Story = {};

export const Unsure: Story = {
  args: {
    title: "Triage the flaky simulator boot",
    summary:
      "Three runs failed to boot a simulator this week, all on the same runtime.",
    rationale: "No clear owner and the logs disagree — this may need a human.",
    confidence: 0.35,
    meta: <Badge tone="warning">needs info</Badge>,
  },
};

/** The next move is a human's, so the card says so instead of offering work. */
export const OpensSomething: Story = {
  args: {
    title: "Get PR #6478 reviewed and merged",
    summary:
      "The work is already written and mergeable. It has been sitting at REVIEW_REQUIRED with no human review.",
    rationale: "Someone else is waiting on it and no code needs writing.",
    confidence: 0.6,
    sourceLabel: "STR-3486",
    primary: {
      kind: "open",
      label: "Open PR #6478",
      onClick: () => undefined,
    },
    meta: <Badge tone="accent">worth a review</Badge>,
  },
};

/** Nothing to do but read it. Dismiss is the only action. */
export const NothingToStart: Story = {
  args: {
    title: "Two Roku tickets are tracking the same campaignId change",
    summary: "Noted so the duplicate does not surprise anyone at standup.",
    confidence: 0.5,
    primary: undefined,
    onOpenSource: undefined,
    sourceLabel: undefined,
    meta: <Badge tone="neutral">suggests ignoring</Badge>,
  },
};

export const WithoutSource: Story = {
  args: { onOpenSource: undefined, sourceLabel: undefined },
};

export const Busy: Story = { args: { busy: true } };
