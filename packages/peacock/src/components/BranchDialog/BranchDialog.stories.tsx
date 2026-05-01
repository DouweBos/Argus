import type { Meta, StoryObj } from "@storybook/react";
import { BranchDialog } from "./BranchDialog";

const meta: Meta<typeof BranchDialog> = {
  title: "Git/BranchDialog",
  component: BranchDialog,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof BranchDialog>;

const noop = () => undefined;

export const Default: Story = {
  args: {
    open: true,
    currentBranch: "main",
    branchOptions: ["main", "develop", "feature/git-client"],
    onConfirm: noop,
    onCancel: noop,
  },
};

export const BranchFromOther: Story = {
  args: {
    open: true,
    currentBranch: "main",
    branchOptions: ["main", "develop", "feature/git-client"],
    defaultName: "feature/new-thing",
    defaultStartPoint: "develop",
    onConfirm: noop,
    onCancel: noop,
  },
};

export const ValidationError: Story = {
  args: {
    open: true,
    currentBranch: "main",
    branchOptions: ["main"],
    defaultName: "feature/exists",
    validationError: "A branch named 'feature/exists' already exists.",
    onConfirm: noop,
    onCancel: noop,
  },
};
