import type { Meta, StoryObj } from "@storybook/react";
import { IssueStatusIcon } from "./IssueStatusIcon";

const meta: Meta<typeof IssueStatusIcon> = {
  title: "Components/IssueStatusIcon",
  component: IssueStatusIcon,
};

export default meta;

type Story = StoryObj<typeof IssueStatusIcon>;

export const AllTypes: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
      {[
        "triage",
        "backlog",
        "unstarted",
        "started",
        "completed",
        "canceled",
        "duplicate",
      ].map((type) => (
        <span
          key={type}
          style={{ display: "flex", gap: 6, alignItems: "center" }}
        >
          <IssueStatusIcon type={type} />
          {type}
        </span>
      ))}
    </div>
  ),
};
