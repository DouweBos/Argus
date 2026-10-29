import type { Meta, StoryObj } from "@storybook/react";
import { BackgroundTaskStatus } from "./BackgroundTaskStatus";

const NOW = 1_800_000_000_000;

const meta: Meta<typeof BackgroundTaskStatus> = {
  title: "Chat/BackgroundTaskStatus",
  component: BackgroundTaskStatus,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof BackgroundTaskStatus>;

export const Running: Story = {
  args: { task: { status: "running", startedAt: NOW - 252_000 }, now: NOW },
};

export const RunningLive: Story = {
  args: { task: { status: "running", startedAt: Date.now() - 65_000 } },
};

export const Done: Story = {
  args: {
    task: { status: "completed", startedAt: NOW, durationMs: 1_121_000 },
  },
};

export const Failed: Story = {
  args: { task: { status: "failed", startedAt: NOW, durationMs: 3_000 } },
};

export const Stopped: Story = {
  args: { task: { status: "stopped", startedAt: NOW, durationMs: 60_000 } },
};
