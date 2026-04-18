import type { Meta, StoryObj } from "@storybook/react";
import { WorkspaceCard } from "./WorkspaceCard";

const meta: Meta<typeof WorkspaceCard> = {
  title: "Composites/WorkspaceCard",
  component: WorkspaceCard,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof WorkspaceCard>;

export const Selected: Story = {
  args: {
    branch: "feat/workspace-card",
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
      <WorkspaceCard {...args} />
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
      <WorkspaceCard {...args} />
    </div>
  ),
};
