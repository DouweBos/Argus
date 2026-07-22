import type { Meta, StoryObj } from "@storybook/react";
import { TaskList } from "./TaskList";

const meta: Meta<typeof TaskList> = {
  title: "Chat/TaskList",
  component: TaskList,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof TaskList>;

export const InProgress: Story = {
  args: {
    onDismiss: () => {},
    tasks: [
      { id: "1", subject: "Design the schema", status: "completed" },
      {
        id: "2",
        subject: "Implement the gateway",
        activeForm: "Implementing the gateway",
        status: "in_progress",
      },
      { id: "3", subject: "Wire the web client", status: "pending" },
    ],
  },
};

export const AllDone: Story = {
  args: {
    tasks: [
      { id: "1", subject: "Design the schema", status: "completed" },
      { id: "2", subject: "Implement the gateway", status: "completed" },
    ],
  },
};
