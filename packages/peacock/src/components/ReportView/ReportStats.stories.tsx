import type { Meta, StoryObj } from "@storybook/react";
import { ReportStats } from "./ReportStats";

const meta: Meta<typeof ReportStats> = {
  title: "Data/Report/ReportStats",
  component: ReportStats,
  tags: ["autodocs"],
  render: (args) => (
    <div style={{ width: 720 }}>
      <ReportStats {...args} />
    </div>
  ),
  args: {
    items: [
      { label: "Sessions merged", value: "7", delta: 3 },
      { label: "Open PRs", value: "12", delta: -2 },
      { label: "Agent minutes", value: "94" },
      { label: "Cost", value: "$4.12", delta: 0 },
    ],
  },
};
export default meta;
type Story = StoryObj<typeof ReportStats>;

export const Default: Story = {};

export const NoDeltas: Story = {
  args: {
    items: [
      { label: "Repos scanned", value: "4" },
      { label: "Issues assigned", value: "9" },
    ],
  },
};
