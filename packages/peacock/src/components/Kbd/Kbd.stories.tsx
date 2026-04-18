import type { Meta, StoryObj } from "@storybook/react";
import { Kbd } from "./Kbd";

const meta: Meta<typeof Kbd> = {
  title: "Primitives/Kbd",
  component: Kbd,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof Kbd>;

export const CommandK: Story = { args: { keys: ["⌘", "K"] } };
export const CommandShiftP: Story = { args: { keys: ["⌘", "⇧", "P"] } };
