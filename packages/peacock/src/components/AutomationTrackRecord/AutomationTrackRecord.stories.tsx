import type { Meta, StoryObj } from "@storybook/react";
import { FIXTURE_CALIBRATION } from "../AutomationFields/fixtures";
import { AutomationTrackRecord } from "./AutomationTrackRecord";

const meta: Meta<typeof AutomationTrackRecord> = {
  title: "Automations/AutomationTrackRecord",
  component: AutomationTrackRecord,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof AutomationTrackRecord>;

export const Healthy: Story = { args: { calibration: FIXTURE_CALIBRATION } };

export const Poor: Story = {
  args: {
    calibration: {
      ...FIXTURE_CALIBRATION,
      accepted: 1,
      dismissed: 9,
      acceptance_rate: 0.2,
    },
  },
};

export const NothingDecided: Story = {
  args: { calibration: { ...FIXTURE_CALIBRATION, sample: 0 } },
};
