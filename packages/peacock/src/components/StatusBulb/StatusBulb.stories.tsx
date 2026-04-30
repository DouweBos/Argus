import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatusBulb } from "./StatusBulb";

const meta: Meta<typeof StatusBulb> = {
  title: "Primitives/StatusBulb",
  component: StatusBulb,
  parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof StatusBulb>;

export const Tones: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
      <StatusBulb tone="success" />
      <StatusBulb tone="error" />
      <StatusBulb tone="warning" />
      <StatusBulb tone="pending" />
      <StatusBulb tone="neutral" />
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
      <StatusBulb tone="success" size="sm" />
      <StatusBulb tone="success" size="md" />
      <StatusBulb tone="success" size="lg" />
    </div>
  ),
};

export const Pulsing: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
      <StatusBulb tone="pending" pulse />
      <span style={{ fontFamily: "system-ui", fontSize: 13 }}>Checking…</span>
    </div>
  ),
};
