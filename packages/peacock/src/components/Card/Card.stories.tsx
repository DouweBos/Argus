import type { Meta, StoryObj } from "@storybook/react";
import { Card } from "./Card";

const meta: Meta<typeof Card> = {
  title: "Primitives/Card",
  component: Card,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof Card>;

export const Glass: Story = {
  args: { children: "Glass surface", hoverable: true, style: { width: 260 } },
};

export const Dashed: Story = {
  args: { variant: "dashed", children: "Open repository", style: { width: 260 } },
};

export const Tight: Story = {
  args: {
    variant: "tight",
    children: "Workspace item",
    selected: true,
    style: { width: 260 },
  },
};
