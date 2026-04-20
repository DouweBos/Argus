import type { Meta, StoryObj } from "@storybook/react";
import { StatusPill } from "./StatusPill";

const meta: Meta<typeof StatusPill> = {
  title: "Primitives/StatusPill",
  component: StatusPill,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof StatusPill>;

export const AllTones: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 8 }}>
      <StatusPill tone="pass" />
      <StatusPill tone="warn" />
      <StatusPill tone="fail" />
      <StatusPill tone="skipped" />
      <StatusPill tone="running" />
    </div>
  ),
};
