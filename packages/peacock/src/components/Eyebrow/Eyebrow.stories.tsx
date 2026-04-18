import type { Meta, StoryObj } from "@storybook/react";
import { Eyebrow } from "./Eyebrow";

const meta: Meta<typeof Eyebrow> = {
  title: "Primitives/Eyebrow",
  component: Eyebrow,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof Eyebrow>;

export const Section: Story = { args: { children: "Recent projects" } };
export const WithCount: Story = { args: { children: "Workspaces", count: 5 } };
