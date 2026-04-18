import type { Meta, StoryObj } from "@storybook/react";
import { Badge, StatusDot } from "./Badge";

const meta: Meta<typeof Badge> = {
  title: "Primitives/Badge",
  component: Badge,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof Badge>;

export const ToolCallTags: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <Badge tone="accent">running</Badge>
      <Badge tone="warning">pending</Badge>
      <Badge tone="neutral">done</Badge>
      <Badge tone="error">error</Badge>
    </div>
  ),
};

export const StatusPills: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <Badge tone="warning" size="tag">initializing</Badge>
      <Badge tone="error" size="tag">error</Badge>
    </div>
  ),
};

export const Dots: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
      <StatusDot tone="success" label="agent running" pulse />
      <StatusDot tone="warning" label="initializing" pulse />
      <StatusDot tone="idle" label="idle" />
    </div>
  ),
};
