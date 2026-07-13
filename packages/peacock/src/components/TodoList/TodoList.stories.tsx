import type { Meta, StoryObj } from "@storybook/react";
import { TodoList } from "./TodoList";

const meta: Meta<typeof TodoList> = {
  title: "Chat/TodoList",
  component: TodoList,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof TodoList>;

export const InProgress: Story = {
  args: {
    onDismiss: () => {},
    todos: [
      { content: "Read the plan", status: "completed" },
      {
        content: "Build the kit",
        activeForm: "Building the kit",
        status: "in_progress",
      },
      { content: "Ship it", status: "pending" },
    ],
  },
};
