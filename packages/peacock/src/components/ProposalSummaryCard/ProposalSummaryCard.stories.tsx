import type { Meta, StoryObj } from "@storybook/react";
import { Badge } from "../Badge/Badge";
import { ProposalSummaryCard } from "./ProposalSummaryCard";

const meta: Meta<typeof ProposalSummaryCard> = {
  title: "Primitives/ProposalSummaryCard",
  component: ProposalSummaryCard,
  tags: ["autodocs"],
  args: {
    title: "Fix the crash when opening a deleted worktree",
    summary:
      "argus#412 reproduces every time: the sidebar reads the worktree path after it was removed on disk.",
    confidence: 0.9,
    onOpen: () => undefined,
    meta: (
      <>
        <Badge tone="accent">worth a review</Badge>
        <Badge tone="neutral">argus</Badge>
      </>
    ),
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 520 }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof ProposalSummaryCard>;

export const Default: Story = {};

/** A long summary stops at two lines — the rest is on the proposal's page. */
export const LongSummary: Story = {
  args: {
    title: "Get PR #6478 (campaignId param) reviewed and merged",
    summary:
      "STR-3486 asks the RN client to send `campaignId` on `/timeline` (VOD) and `/library/parts/xxx` (FAST) requests to the VOD/EPG provider. The work is already written: PR #6478 is open, non-draft, mergeable, 156/-2 across 7 files, with only an automated review comment and `reviewDecision: REVIEW_REQUIRED`.",
    confidence: 0.6,
  },
};

export const Unsure: Story = {
  args: {
    title: "Triage the flaky simulator boot",
    summary:
      "Three runs failed to boot a simulator this week, all on the same runtime.",
    confidence: 0.3,
    meta: <Badge tone="warning">needs info</Badge>,
  },
};
