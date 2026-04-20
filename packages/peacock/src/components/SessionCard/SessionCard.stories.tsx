import type { Meta, StoryObj } from "@storybook/react";
import { SessionCard } from "./SessionCard";

const meta: Meta<typeof SessionCard> = {
  title: "Composites/SessionCard",
  component: SessionCard,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof SessionCard>;

export const Selected: Story = {
  args: {
    branch: "feat/session-card",
    repo: "Argus",
    parentBranch: "main",
    selected: true,
    added: 124,
    removed: 37,
    files: 8,
    status: "success",
    pulse: true,
  },
  render: (args) => (
    <div style={{ width: 280 }}>
      <SessionCard {...args} />
    </div>
  ),
};

export const Idle: Story = {
  args: {
    branch: "fix/diff-hunk-staging",
    status: "warning",
  },
  render: (args) => (
    <div style={{ width: 280 }}>
      <SessionCard {...args} />
    </div>
  ),
};
