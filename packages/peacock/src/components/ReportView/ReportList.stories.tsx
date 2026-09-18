import type { Meta, StoryObj } from "@storybook/react";
import { ReportList } from "./ReportList";

const meta: Meta<typeof ReportList> = {
  title: "Data/Report/ReportList",
  component: ReportList,
  tags: ["autodocs"],
  render: (args) => (
    <div style={{ width: 620 }}>
      <ReportList {...args} />
    </div>
  ),
  args: {
    items: [
      { text: "Release build is green on main", tone: "positive" },
      { text: "Two PRs have been open for over a week", tone: "warning" },
      { text: "Simulator smoke test failed on iOS 18.2", tone: "critical" },
      {
        text: "#412 crash on cold start",
        tone: "info",
        href: "https://example.com/412",
      },
    ],
  },
};
export default meta;
type Story = StoryObj<typeof ReportList>;

export const Toned: Story = {};

export const Plain: Story = {
  args: {
    items: [
      { text: "Reviewed four pull requests" },
      { text: "Rebased the release branch" },
    ],
  },
};
