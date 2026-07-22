import type { Meta, StoryObj } from "@storybook/react";
import { BranchDivergence } from "./BranchDivergence";

const meta: Meta<typeof BranchDivergence> = {
  title: "Primitives/BranchDivergence",
  component: BranchDivergence,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof BranchDivergence>;

export const AheadBehindDirty: Story = {
  args: { ahead: 1, behind: 541, dirty: 1 },
};
export const DirtyOnly: Story = { args: { dirty: 3 } };
export const AheadOnly: Story = { args: { ahead: 2 } };
