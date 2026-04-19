import type { Meta, StoryObj } from "@storybook/react";
import { UsageMeter } from "./UsageMeter";

const meta: Meta<typeof UsageMeter> = {
  title: "Primitives/UsageMeter",
  component: UsageMeter,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof UsageMeter>;

export const Default: Story = {
  args: {
    label: "Session",
    value: "1.2M tok",
    progress: 0.42,
    hint: "resets in 3h 11m",
  },
};

export const Warning: Story = {
  args: {
    label: "Week",
    value: "18.4M tok",
    progress: 0.82,
    tone: "warning",
    hint: "rolling 7 days",
  },
};

export const Danger: Story = {
  args: {
    label: "Session",
    value: "4.8M tok",
    progress: 0.97,
    tone: "danger",
    hint: "resets in 14m",
  },
};

export const TextOnly: Story = {
  args: {
    label: "Session",
    value: "—",
    hint: "idle",
  },
};
