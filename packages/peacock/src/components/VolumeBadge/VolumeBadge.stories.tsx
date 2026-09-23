import type { Meta, StoryObj } from "@storybook/react";
import { VolumeBadge } from "./VolumeBadge";

const meta: Meta<typeof VolumeBadge> = {
  title: "Components/VolumeBadge",
  component: VolumeBadge,
  args: { label: "Blackbox" },
};

export default meta;
type Story = StoryObj<typeof VolumeBadge>;

export const Available: Story = {};

/** The state the badge exists for: the drive is out, the sessions are frozen. */
export const Unavailable: Story = { args: { state: "unavailable" } };

export const LongDriveName: Story = {
  args: { label: "Douwe's Very Large External SSD", state: "unavailable" },
};
