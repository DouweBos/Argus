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
    onStart: () => undefined,
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

export const WithoutSource: Story = {
  args: { onOpenSource: undefined, sourceLabel: undefined },
};

export const Busy: Story = { args: { busy: true } };
