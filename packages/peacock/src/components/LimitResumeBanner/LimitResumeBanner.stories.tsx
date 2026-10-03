import type { Meta, StoryObj } from "@storybook/react";
import { LimitResumeBanner } from "./LimitResumeBanner";

const NOW = new Date("2026-10-03T12:00:00");

const meta: Meta<typeof LimitResumeBanner> = {
  title: "Components/LimitResumeBanner",
  component: LimitResumeBanner,
  args: { now: NOW },
};

export default meta;

type Story = StoryObj<typeof LimitResumeBanner>;

export const LaterToday: Story = {
  args: { resumeAt: new Date("2026-10-03T15:01:00").getTime() },
};

export const AnotherDay: Story = {
  args: { resumeAt: new Date("2026-10-06T09:00:00").getTime() },
};
