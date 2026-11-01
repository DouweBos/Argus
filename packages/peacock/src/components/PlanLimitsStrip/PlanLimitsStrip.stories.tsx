import type { Meta, StoryObj } from "@storybook/react";
import { PlanLimitsStrip } from "./PlanLimitsStrip";

const meta: Meta<typeof PlanLimitsStrip> = {
  title: "Primitives/PlanLimitsStrip",
  component: PlanLimitsStrip,
  tags: ["autodocs"],
  args: { onClick: () => {} },
};
export default meta;
type Story = StoryObj<typeof PlanLimitsStrip>;

export const Normal: Story = {
  args: {
    limits: [
      {
        id: "session",
        label: "Session",
        value: "73% left",
        progress: 0.73,
        title: "Resets in 4h 29m",
      },
      {
        id: "weekly",
        label: "Weekly",
        value: "58% left",
        progress: 0.58,
        title: "Resets in 5d 1h",
      },
    ],
  },
};

export const Warning: Story = {
  args: {
    limits: [
      {
        id: "session",
        label: "Session",
        value: "61% left",
        progress: 0.61,
      },
      {
        id: "weekly",
        label: "Weekly",
        value: "18% left",
        progress: 0.18,
        tone: "warning",
        title: "Resets in 2d 3h",
      },
    ],
  },
};

export const Critical: Story = {
  args: {
    limits: [
      {
        id: "session",
        label: "Session",
        value: "4% left",
        progress: 0.04,
        tone: "danger",
        title: "Resets in 14m",
      },
    ],
  },
};

export const SeveralAccounts: Story = {
  args: {
    limits: [
      {
        id: "work",
        label: "Work · Weekly",
        value: "40% left",
        progress: 0.4,
        title: "Resets in 3d",
      },
      {
        id: "personal",
        label: "Personal · Session",
        value: "9% left",
        progress: 0.09,
        tone: "danger",
        title: "Resets in 1h 2m",
      },
      {
        id: "team",
        label: "Team · Session",
        value: "22% left",
        progress: 0.22,
        tone: "warning",
        title: "Resets in 2h 40m",
      },
    ],
  },
};
