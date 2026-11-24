import type { Meta, StoryObj } from "@storybook/react";
import { Badge } from "../Badge/Badge";
import { Button } from "../Button/Button";
import { TeammateDutiesPanel } from "./TeammateDutiesPanel";

const row = {
  enabled: true,
  onToggleEnabled: () => undefined,
  onOpen: () => undefined,
  actions: (
    <Button size="sm" variant="ghost">
      Remove from teammate
    </Button>
  ),
};

const meta: Meta<typeof TeammateDutiesPanel> = {
  title: "Automations/TeammateDutiesPanel",
  component: TeammateDutiesPanel,
  tags: ["autodocs"],
  args: {
    action: (
      <Button size="sm" variant="secondary">
        Move an automation here
      </Button>
    ),
    rows: [
      {
        ...row,
        id: "a1",
        name: "Fix failing checks",
        trigger: "On a failed check",
        lastRunStatus: <Badge tone="accent">running</Badge>,
        lastRunLabel: "just now",
        nextRunLabel: "On its signal",
      },
      {
        ...row,
        id: "a2",
        name: "Nightly flaky sweep",
        trigger: "03:00 daily",
        lastRunStatus: <Badge tone="error">failed</Badge>,
        lastRunLabel: "9h ago",
        nextRunLabel: "Tonight 03:00 (in 14h)",
      },
    ],
  },
};
export default meta;
type Story = StoryObj<typeof TeammateDutiesPanel>;

export const Default: Story = {};

export const Empty: Story = { args: { rows: [] } };

export const MonitorOnly: Story = {
  args: { action: undefined },
};
