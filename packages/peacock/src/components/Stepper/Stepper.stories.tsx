import type { Meta, StoryObj } from "@storybook/react";
import { Stepper } from "./Stepper";

const meta: Meta<typeof Stepper> = {
  title: "Primitives/Stepper",
  component: Stepper,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof Stepper>;

const steps = [
  { id: "welcome", label: "Welcome" },
  { id: "preflight", label: "Preflight" },
  { id: "project", label: "Project" },
  { id: "agent", label: "First agent" },
];

export const Default: Story = {
  render: () => <Stepper steps={steps} currentIndex={1} />,
};

export const Complete: Story = {
  render: () => <Stepper steps={steps} currentIndex={steps.length} />,
};
