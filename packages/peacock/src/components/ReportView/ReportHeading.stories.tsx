import type { Meta, StoryObj } from "@storybook/react";
import { ReportHeading } from "./ReportHeading";

const meta: Meta<typeof ReportHeading> = {
  title: "Data/Report/ReportHeading",
  component: ReportHeading,
  tags: ["autodocs"],
  args: { text: "What moved yesterday" },
};
export default meta;
type Story = StoryObj<typeof ReportHeading>;

export const Default: Story = {};

export const Long: Story = {
  args: {
    text: "Pull requests that have been waiting on review for more than two days",
  },
};
