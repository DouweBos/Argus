import type { Meta, StoryObj } from "@storybook/react";
import { Chip } from "./Chip";

const meta: Meta<typeof Chip> = {
  title: "Primitives/Chip",
  component: Chip,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof Chip>;

export const ModelPicker: Story = {
  args: { mono: true, children: "sonnet-4.5" },
};
export const PlanMode: Story = { args: { muted: true, children: "Plan mode" } };
export const Dismissible: Story = {
  args: {
    mono: true,
    children: "feat/workspace-card",
    onDismiss: () => {},
  },
};
