import type { Meta, StoryObj } from "@storybook/react";
import { ConfidenceMeter } from "./ConfidenceMeter";

const meta: Meta<typeof ConfidenceMeter> = {
  title: "Primitives/ConfidenceMeter",
  component: ConfidenceMeter,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof ConfidenceMeter>;

export const High: Story = { args: { value: 0.92 } };
export const Medium: Story = { args: { value: 0.61 } };
export const Low: Story = { args: { value: 0.2 } };
export const None: Story = { args: { value: 0 } };
export const Compact: Story = { args: { value: 0.85, compact: true } };

export const Ladder: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {[0, 0.15, 0.35, 0.55, 0.75, 0.95].map((v) => (
        <ConfidenceMeter key={v} value={v} />
      ))}
    </div>
  ),
};
