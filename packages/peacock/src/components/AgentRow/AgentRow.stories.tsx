import type { Meta, StoryObj } from "@storybook/react";
import { AgentRow } from "./AgentRow";

const meta: Meta<typeof AgentRow> = {
  title: "Composites/AgentRow",
  component: AgentRow,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof AgentRow>;

export const List: Story = {
  render: () => (
    <div
      style={{
        width: 480,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <AgentRow
        name="feat/workspace-card"
        project="Argus"
        tool="Edit WorkspaceCard.tsx"
        status="running"
        meta="~2m"
        model="sonnet-4.5"
      />
      <AgentRow
        name="fix/diff-hunk-staging"
        project="Argus"
        tool="awaiting approval"
        status="pending"
        model="sonnet-4.5"
      />
      <AgentRow
        name="feat/notifications-v2"
        project="linear-web"
        tool="build failed: 3 errors"
        status="error"
        model="sonnet-4.5"
      />
      <AgentRow
        name="feat/theme-tokens"
        project="studio-android"
        tool="conversation paused"
        status="idle"
        model="sonnet-4.5"
      />
    </div>
  ),
};
