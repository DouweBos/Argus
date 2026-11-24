import type { Meta, StoryObj } from "@storybook/react";
import { TeammateThreadList } from "./TeammateThreadList";

const meta: Meta<typeof TeammateThreadList> = {
  title: "Primitives/TeammateThreadList",
  component: TeammateThreadList,
  tags: ["autodocs"],
  args: {
    threads: [
      {
        id: "t1",
        title: "What did you find this morning?",
        lastOpenedLabel: "just now",
      },
      {
        id: "t2",
        title: "Why is the e2e suite flaky on CI?",
        lastOpenedLabel: "3h ago",
      },
      {
        id: "t4",
        title: "Can you look at the deploy alert?",
        lastOpenedLabel: "5h ago",
        surfaceLabel: "Slack",
      },
      {
        id: "t5",
        title: "Asked by PR Reviewer: is this flake known?",
        lastOpenedLabel: "1d ago",
        surfaceLabel: "Handoff",
      },
      { id: "t3", title: "", lastOpenedLabel: "2d ago" },
    ],
    selectedId: "t1",
    onOpen: () => undefined,
    onNew: () => undefined,
    onArchive: () => undefined,
  },
  decorators: [
    (Story) => (
      <div style={{ width: 240 }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof TeammateThreadList>;

export const Default: Story = {};

export const Empty: Story = { args: { threads: [] } };

export const MonitorOnly: Story = {
  args: { onNew: undefined, onArchive: undefined },
};
