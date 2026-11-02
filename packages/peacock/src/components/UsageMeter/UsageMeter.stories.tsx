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

export const Large: Story = {
  args: {
    size: "lg",
    label: "Session",
    value: "73% left",
    progress: 0.27,
    hint: "Resets in 4h 29m",
    aside: "Under pace",
  },
};

/** Home's plan-limit line, as Argus for Mac draws it. */
export const Row: Story = {
  args: {
    size: "row",
    label: "Session",
    value: "93% left",
    progress: 0.07,
    hint: "resets in 4h 27m",
  },
};

export const LargeAheadOfPace: Story = {
  args: {
    size: "lg",
    label: "Weekly · Fable",
    value: "18% left",
    progress: 0.82,
    tone: "warning",
    hint: "Resets in 5d 1h",
    aside: "Ahead of pace",
  },
};

export const LargeNearlySpent: Story = {
  args: {
    size: "lg",
    label: "Monthly spend",
    value: "4% left",
    progress: 0.96,
    tone: "danger",
  },
};
