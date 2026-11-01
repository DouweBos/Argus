import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { ToolCallRow } from "../ToolCallRow/ToolCallRow";
import { CollapsedToolGroup } from "./CollapsedToolGroup";

const meta: Meta<typeof CollapsedToolGroup> = {
  title: "Components/CollapsedToolGroup",
  component: CollapsedToolGroup,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "A run of consecutive tool calls folded into one summary row, with an icon per kind of call. Opens in place to show the calls.",
      },
    },
  },
  args: {
    toolCallCount: 5,
    messageCount: 3,
    categories: { read: 3, search: 1, bash: 1 },
    expanded: false,
    onToggle: () => {},
  },
};

export default meta;

type Story = StoryObj<typeof CollapsedToolGroup>;

export const Folded: Story = {};

export const WithTimestamps: Story = {
  args: {
    timestamp: new Date("2026-10-03T12:00:00").getTime(),
    endTimestamp: new Date("2026-10-03T12:04:00").getTime(),
  },
};

export const BackgroundStillRunning: Story = {
  args: {
    categories: { agent: 2, read: 1 },
    stillRunning: "2 agents still running",
    toolCallCount: 3,
  },
};

export const Expanded: Story = {
  render: (args) => {
    const [expanded, setExpanded] = useState(true);

    return (
      <CollapsedToolGroup
        {...args}
        expanded={expanded}
        onToggle={() => setExpanded((e) => !e)}
      >
        <ToolCallRow detail="src/login.ts" status="done" tool="Read" />
        <ToolCallRow detail="validate" status="done" tool="Grep" />
      </CollapsedToolGroup>
    );
  },
};
