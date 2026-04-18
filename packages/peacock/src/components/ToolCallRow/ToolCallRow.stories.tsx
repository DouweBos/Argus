import type { Meta, StoryObj } from "@storybook/react";
import { ToolCallRow } from "./ToolCallRow";

const meta: Meta<typeof ToolCallRow> = {
  title: "Composites/ToolCallRow",
  component: ToolCallRow,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof ToolCallRow>;

export const Timeline: Story = {
  render: () => (
    <div style={{ width: 480, display: "flex", flexDirection: "column" }}>
      <ToolCallRow
        tool="Read"
        detail="app/components/sidebar/WorkspaceCard.tsx"
        status="done"
      />
      <ToolCallRow
        tool="Bash"
        detail="pnpm install --frozen-lockfile"
        status="pending"
      />
      <ToolCallRow tool="Edit" detail="app/styles/global.css" status="running" />
    </div>
  ),
};
