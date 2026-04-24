import type { Meta, StoryObj } from "@storybook/react";
import { ContextMeter } from "./ContextMeter";

const meta: Meta<typeof ContextMeter> = {
  title: "Primitives/ContextMeter",
  component: ContextMeter,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof ContextMeter>;

export const Low: Story = { args: { progress: 0.12 } };
export const Mid: Story = { args: { progress: 0.45 } };
export const Warning: Story = { args: { progress: 0.78 } };
export const Danger: Story = { args: { progress: 0.96 } };
export const Full: Story = { args: { progress: 1 } };
export const Large: Story = { args: { progress: 0.6, size: 32, stroke: 3 } };
