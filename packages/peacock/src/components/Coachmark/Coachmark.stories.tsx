import type { Meta, StoryObj } from "@storybook/react";
import { Coachmark } from "./Coachmark";

const meta: Meta<typeof Coachmark> = {
  title: "Primitives/Coachmark",
  component: Coachmark,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof Coachmark>;

export const Default: Story = {
  args: {
    title: "Your sessions live here",
    description:
      "Each row is an isolated git worktree. Create one per parallel task.",
    progress: "1 / 3",
    nextLabel: "Next",
  },
};
