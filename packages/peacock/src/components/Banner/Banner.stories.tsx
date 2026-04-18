import type { Meta, StoryObj } from "@storybook/react";
import { Banner } from "./Banner";

const meta: Meta<typeof Banner> = {
  title: "Components/Banner",
  component: Banner,
  parameters: { layout: "fullscreen" },
};

export default meta;

type Story = StoryObj<typeof Banner>;

export const Warning: Story = {
  args: {
    tone: "warning",
    children:
      "Claude Code CLI not found on PATH. Agents will not work until it is installed.",
  },
};

export const Error: Story = {
  args: {
    tone: "error",
    children: "Could not open /Users/douwe/Projects/ghost (permission denied).",
  },
};

export const Info: Story = {
  args: {
    tone: "info",
    children: "Plan mode is active — edits will be proposed, not applied.",
  },
};

export const Success: Story = {
  args: {
    tone: "success",
    children: "Merged into main successfully.",
  },
};
