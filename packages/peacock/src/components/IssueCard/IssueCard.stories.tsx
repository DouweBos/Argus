import type { Meta, StoryObj } from "@storybook/react";
import { IssueCard } from "./IssueCard";

const meta: Meta<typeof IssueCard> = {
  title: "Components/IssueCard",
  component: IssueCard,
  decorators: [(Story) => <div style={{ width: 300 }}>{Story()}</div>],
};

export default meta;

type Story = StoryObj<typeof IssueCard>;

export const Full: Story = {
  args: {
    identifier: "STR-4294",
    title: "Kochava SDK Updates (Android + iOS)",
    statusType: "started",
    priority: 2,
    estimate: 3,
    cycle: "Cycle 59",
    project: "Growth",
    pullRequestCount: 2,
    labels: ["Android", "iOS"],
    assignee: { name: "Douwe Bos" },
    footnote: "Created Sep 22",
  },
};

export const WithAgent: Story = {
  args: {
    ...Full.args,
    badge: "Agent working",
    selected: true,
  },
};

export const Minimal: Story = {
  args: {
    identifier: "RNG-876",
    title: "Primary nav remains open after switching users",
    statusType: "unstarted",
    priority: 0,
  },
};

export const SubIssue: Story = {
  args: {
    identifier: "RNG-872",
    parent: "RNG-800",
    title: "Release RN through the legacy Tizen and webOS loaders",
    statusType: "started",
    priority: 1,
    pullRequestCount: 5,
  },
};
