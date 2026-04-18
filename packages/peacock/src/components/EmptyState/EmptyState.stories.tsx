import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../Button/Button";
import { EmptyState } from "./EmptyState";

const meta: Meta<typeof EmptyState> = {
  title: "Components/EmptyState",
  component: EmptyState,
  parameters: { layout: "centered" },
  args: {
    title: "No agent running",
    body: "Spin up a Claude Code agent to start working on this workspace.",
  },
};
export default meta;

type Story = StoryObj<typeof EmptyState>;

export const Default: Story = {};

export const WithAction: Story = {
  args: {
    action: <Button variant="secondary">Start Agent</Button>,
  },
};

export const WithIcon: Story = {
  args: {
    icon: (
      <svg fill="currentColor" height={24} viewBox="0 0 16 16" width={24}>
        <rect height="10" rx="1" width="10" x="3" y="3" />
      </svg>
    ),
    action: <Button variant="primary">Start Agent</Button>,
  },
};

export const MessageOnly: Story = {
  args: {
    title: "No agents in this workspace.",
    body: undefined,
  },
};
