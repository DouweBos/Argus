import type { Meta, StoryObj } from "@storybook/react";
import { ThinkingDots } from "./ThinkingDots";

const meta: Meta<typeof ThinkingDots> = {
  title: "Primitives/ThinkingDots",
  component: ThinkingDots,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof ThinkingDots>;

export const Default: Story = {};
