import type { Meta, StoryObj } from "@storybook/react";
import { ReportTable } from "./ReportTable";

const meta: Meta<typeof ReportTable> = {
  title: "Data/Report/ReportTable",
  component: ReportTable,
  tags: ["autodocs"],
  render: (args) => (
    <div style={{ width: 720 }}>
      <ReportTable {...args} />
    </div>
  ),
  args: {
    columns: ["Repo", "Open PRs", "Oldest"],
    rows: [
      ["argus", 6, "3d"],
      ["peacock", 2, "9h"],
      ["conductor", 11, "12d"],
    ],
  },
};
export default meta;
type Story = StoryObj<typeof ReportTable>;

export const Default: Story = {};

export const Empty: Story = { args: { rows: [] } };

export const Wide: Story = {
  args: {
    columns: ["Issue", "Repo", "Assignee", "Age", "Estimate", "Confidence"],
    rows: [
      ["#412 crash on cold start", "argus", "douwe", "2d", 1, 0.82],
      ["#418 flaky merge test", "argus", "unassigned", "5d", 3, 0.44],
    ],
  },
};
