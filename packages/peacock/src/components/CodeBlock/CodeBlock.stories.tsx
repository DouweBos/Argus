import type { Meta, StoryObj } from "@storybook/react";
import { CodeBlock } from "./CodeBlock";

const meta: Meta<typeof CodeBlock> = {
  title: "Primitives/CodeBlock",
  component: CodeBlock,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof CodeBlock>;

export const Default: Story = {
  args: {
    code: "npm install -g @anthropic-ai/claude-code",
    language: "bash",
  },
};
