import type { Meta, StoryObj } from "@storybook/react";
import { Badge } from "../Badge/Badge";
import { Button } from "../Button/Button";
import { AutomationsListView } from "./AutomationsListView";

const noop = () => undefined;

const meta: Meta<typeof AutomationsListView> = {
  title: "Automations/AutomationsListView",
  component: AutomationsListView,
  tags: ["autodocs"],
  args: {
    header: true,
    onQuickRun: noop,
    onDescribe: noop,
    onNew: noop,
    rows: [],
  },
};
export default meta;
type Story = StoryObj<typeof AutomationsListView>;

export const List: Story = {
  args: {
    phase: { kind: "content" },
    quickRunCount: 3,
    rows: [
      {
        id: "a1",
        name: "Morning triage",
        description: "Reads new issues and failing CI.",
        trigger: "09:00 weekdays",
        enabled: true,
        lastRunStatus: <Badge tone="success">succeeded</Badge>,
        lastRunLabel: "3h ago",
        nextRunLabel: "Nov 3, 09:00 (in 18h)",
        actions: (
          <Button size="sm" variant="secondary">
            Run now
          </Button>
        ),
        onOpen: noop,
        onToggleEnabled: noop,
      },
      {
        id: "a2",
        name: "Stale branches",
        trigger: "Manual",
        enabled: false,
        lastRunLabel: "Never",
        nextRunLabel: "Manual",
        onOpen: noop,
        onToggleEnabled: noop,
      },
    ],
  },
};

export const Empty: Story = { args: { phase: { kind: "empty" } } };

export const Loading: Story = { args: { phase: { kind: "loading" } } };

export const MonitorOnly: Story = {
  args: { ...List.args, onDescribe: undefined, onNew: undefined },
};

export const Failed: Story = {
  args: {
    phase: { kind: "failed", error: "Not connected to a computer." },
    onRetry: noop,
  },
};
