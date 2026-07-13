import type { Meta, StoryObj } from "@storybook/react";
import { QuestionForm } from "./QuestionForm";

const meta: Meta<typeof QuestionForm> = {
  title: "Agent/QuestionForm",
  component: QuestionForm,
  parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof QuestionForm>;

export const SingleSelect: Story = {
  args: {
    questions: [
      {
        header: "Task",
        question: "What would you like to work on in this session?",
        options: [
          { label: "Drawer menu work", description: "Continue on the branch." },
          { label: "New feature/fix", description: "Start something new." },
          {
            label: "Code review",
            description: "Review local changes or a PR.",
          },
          {
            label: "Just testing",
            description: "Check the question tool works.",
          },
        ],
      },
    ],
    onSubmit: (answer) => alert(answer),
    onCancel: () => {},
  },
};

export const MultiSelect: Story = {
  args: {
    questions: [
      {
        header: "Platforms",
        question: "Which platforms should this target?",
        multiSelect: true,
        options: [
          { label: "iOS" },
          { label: "Android" },
          { label: "tvOS" },
          { label: "Web" },
        ],
      },
    ],
    onSubmit: (answer) => alert(answer),
    onCancel: () => {},
  },
};
