import type { Meta, StoryObj } from "@storybook/react";
import { AnsweredQuestion } from "./AnsweredQuestion";

const meta: Meta<typeof AnsweredQuestion> = {
  title: "Composites/AnsweredQuestion",
  component: AnsweredQuestion,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof AnsweredQuestion>;

export const Default: Story = {
  args: {
    header: "Deployment target",
    answers: [
      {
        label: "Staging",
        description: "Deploy to the staging cluster for QA review.",
      },
    ],
  },
};

export const LabelOnly: Story = {
  args: {
    header: "Confirm migration",
    answers: [{ label: "Yes, run migration" }],
  },
};

export const MultipleAnswers: Story = {
  args: {
    header: "Environments to seed",
    answers: [
      { label: "Staging", description: "QA + integration testing." },
      { label: "Preview", description: "PR preview environments." },
    ],
  },
};

export const NoAnswer: Story = {
  args: {
    header: "Deployment target",
    answers: [],
  },
};

export const Stacked: Story = {
  render: () => (
    <div
      style={{ width: 480, display: "flex", flexDirection: "column", gap: 8 }}
    >
      <AnsweredQuestion
        header="Deployment target"
        answers={[
          {
            label: "Staging",
            description: "Deploy to the staging cluster for QA review.",
          },
        ]}
      />
      <AnsweredQuestion
        header="Notify channels"
        answers={[
          { label: "#deploys", description: "Deploy feed." },
          { label: "#oncall", description: "Oncall rotation channel." },
        ]}
      />
    </div>
  ),
};
