import type { Meta, StoryObj } from "@storybook/react";
import { FormField } from "./FormField";

const meta: Meta<typeof FormField> = {
  title: "Primitives/FormField",
  component: FormField,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof FormField>;

export const Default: Story = {
  args: {
    label: "Git name",
    helper: "Used as commit author inside worktrees.",
    children: <input placeholder="Your name" />,
  },
};
