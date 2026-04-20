import type { Meta, StoryObj } from "@storybook/react";
import { SegmentedCard } from "./SegmentedCard";

const meta: Meta<typeof SegmentedCard> = {
  title: "Primitives/SegmentedCard",
  component: SegmentedCard,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof SegmentedCard>;

export const Default: Story = {
  args: {
    title: "Open existing",
    description: "Pick a folder that already contains a git repo.",
  },
};

export const Selected: Story = {
  args: {
    title: "Clone from Git",
    description: "Paste a URL; we will clone it into your Projects folder.",
    selected: true,
  },
};
