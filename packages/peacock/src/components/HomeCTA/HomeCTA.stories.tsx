import type { Meta, StoryObj } from "@storybook/react";
import { HomeCTA } from "./HomeCTA";

const meta: Meta<typeof HomeCTA> = {
  title: "Composites/HomeCTA",
  component: HomeCTA,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof HomeCTA>;

export const Default: Story = { args: { children: "Open repository" } };
