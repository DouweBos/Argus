import type { Meta, StoryObj } from "@storybook/react";
import { AgentIcon, WarningIcon } from "../../icons/Icons";
import { Badge } from "../Badge/Badge";
import { Button } from "../Button/Button";
import { InboxItemRow } from "./InboxItemRow";

const meta: Meta<typeof InboxItemRow> = {
  title: "Primitives/InboxItemRow",
  component: InboxItemRow,
  tags: ["autodocs"],
  args: { onOpen: () => undefined },
};
export default meta;
type Story = StoryObj<typeof InboxItemRow>;

export const InFlight: Story = {
  args: {
    leading: <AgentIcon size={12} />,
    title: "Fix the crash when opening a deleted worktree",
    subtitle: "Argus · douwe/fix-worktree-crash",
    meta: <Badge tone="accent">running</Badge>,
  },
};

export const ReadyToMerge: Story = {
  args: {
    leading: <AgentIcon size={12} />,
    title: "Bump the flaky simulator timeout",
    subtitle: "Argus · douwe/sim-timeout",
    meta: <Badge tone="success">3 commits ready</Badge>,
    actions: (
      <Button size="sm" variant="secondary">
        Review
      </Button>
    ),
  },
};

export const FailedRun: Story = {
  args: {
    tone: "alert",
    leading: <WarningIcon size={12} />,
    title: "Morning triage",
    subtitle: "gh: not authenticated",
    meta: <Badge tone="error">failed</Badge>,
  },
};
