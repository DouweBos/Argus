import type { Meta, StoryObj } from "@storybook/react";
import { StartHeading } from "./StartHeading";

const meta: Meta<typeof StartHeading> = {
  title: "Composites/StartHeading",
  component: StartHeading,
};
export default meta;
type Story = StoryObj<typeof StartHeading>;

export const InProject: Story = {
  args: { project: "awm-repo", subtitle: "Explain Greet Helper" },
};

export const NoProject: Story = { args: { subtitle: "Scratch pad" } };
