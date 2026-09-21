import type { Meta, StoryObj } from "@storybook/react-vite";
import { GateLogRow } from "./GateLogRow";

const meta: Meta<typeof GateLogRow> = {
  title: "Components/GateLogRow",
  component: GateLogRow,
  args: {
    automationName: "Regression sweep",
    attempted: "conductor screenshot /tmp/step-1.png",
    suggestedEntry: "conductor screenshot",
    count: 1,
    lastSeen: "2h ago",
    onAllow: () => undefined,
    onDismiss: () => undefined,
  },
};
export default meta;
type Story = StoryObj<typeof GateLogRow>;

export const Once: Story = {};

/** A playbook that tries the same thing every morning collapses to one row. */
export const Repeated: Story = { args: { count: 14, lastSeen: "9m ago" } };

/** A refused tool call rather than a shell command. */
export const Tool: Story = {
  args: {
    automationName: "Branch janitor",
    attempted: "mcp__argus__trigger_run",
    suggestedEntry: "mcp__argus__trigger_run",
    count: 3,
  },
};

/** Long command lines truncate rather than pushing the buttons off. */
export const LongCommand: Story = {
  args: {
    attempted:
      'gh api graphql -f query=\'query { repository(owner:"o", name:"r") { pullRequests(last: 50) { nodes { title } } } }\'',
    suggestedEntry: "gh api",
  },
};
