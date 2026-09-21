import type { Meta, StoryObj } from "@storybook/react";
import { Badge } from "../Badge/Badge";
import { Button } from "../Button/Button";
import { AutomationRow } from "./AutomationRow";

const meta: Meta<typeof AutomationRow> = {
  title: "Primitives/AutomationRow",
  component: AutomationRow,
  tags: ["autodocs"],
  args: {
    name: "Standup digest",
    description: "A daily read-only summary of what every agent did yesterday.",
    trigger: "0 9 * * 1-5",
    enabled: true,
    lastRunLabel: "2h ago",
    nextRunLabel: "Tomorrow 09:00 (in 19h)",
    onToggleEnabled: () => undefined,
    actions: (
      <Button size="sm" variant="secondary">
        Run
      </Button>
    ),
  },
};
export default meta;
type Story = StoryObj<typeof AutomationRow>;

export const Scheduled: Story = {
  args: { lastRunStatus: <Badge tone="success">succeeded</Badge> },
};

export const Running: Story = {
  args: {
    lastRunStatus: <Badge tone="accent">running</Badge>,
    lastRunLabel: "just now",
    actions: (
      <Button size="sm" variant="danger">
        Cancel
      </Button>
    ),
  },
};

export const Paused: Story = {
  args: {
    enabled: false,
    nextRunLabel: "Paused",
    lastRunStatus: <Badge tone="error">failed</Badge>,
    lastRunLabel: "3d ago",
  },
};

export const ManualOnly: Story = {
  args: {
    name: "Release notes sweep",
    description: "Only ever runs when you ask it to.",
    trigger: "Manual only",
    nextRunLabel: "Manual",
    lastRunLabel: "Never",
  },
};

export const Selected: Story = {
  args: {
    selected: true,
    lastRunStatus: <Badge tone="success">succeeded</Badge>,
  },
};
