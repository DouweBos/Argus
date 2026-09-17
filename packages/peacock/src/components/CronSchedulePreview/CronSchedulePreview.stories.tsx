import type { Meta, StoryObj } from "@storybook/react";
import { CronSchedulePreview } from "./CronSchedulePreview";

const meta: Meta<typeof CronSchedulePreview> = {
  title: "Primitives/CronSchedulePreview",
  component: CronSchedulePreview,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof CronSchedulePreview>;

export const EveryFiveMinutes: Story = {
  args: {
    timezone: "Europe/Amsterdam",
    times: [
      "Mon 17 Sep, 09:05",
      "Mon 17 Sep, 09:10",
      "Mon 17 Sep, 09:15",
      "Mon 17 Sep, 09:20",
      "Mon 17 Sep, 09:25",
    ],
  },
};

export const FivePastTheHour: Story = {
  args: {
    timezone: "Europe/Amsterdam",
    times: [
      "Mon 17 Sep, 09:05",
      "Mon 17 Sep, 10:05",
      "Mon 17 Sep, 11:05",
      "Mon 17 Sep, 12:05",
      "Mon 17 Sep, 13:05",
    ],
  },
};

export const Invalid: Story = {
  args: {
    times: [],
    error: "Five fields, `min hour dom mon dow`.",
  },
};

export const NeverFires: Story = {
  args: { times: [], timezone: "UTC" },
};
