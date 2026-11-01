import type { Meta, StoryObj } from "@storybook/react";
import { HighlightedText } from "./HighlightedText";

const meta: Meta<typeof HighlightedText> = {
  title: "Primitives/HighlightedText",
  component: HighlightedText,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof HighlightedText>;

export const FuzzyMatch: Story = {
  args: { text: "CodeView.swift", indices: [0, 4] },
};

export const Run: Story = {
  args: { text: "useTerminal.ts", indices: [3, 4, 5, 6, 7, 8, 9, 10] },
};

export const Plain: Story = { args: { text: "README.md" } };
