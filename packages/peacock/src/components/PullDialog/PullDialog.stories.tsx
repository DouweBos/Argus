import type { Meta, StoryObj } from "@storybook/react";
import { PullDialog } from "./PullDialog";

const meta: Meta<typeof PullDialog> = {
  title: "Git/PullDialog",
  component: PullDialog,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof PullDialog>;

const noop = () => undefined;

export const Default: Story = {
  args: { open: true, onConfirm: noop, onCancel: noop },
};

export const Rebase: Story = {
  args: {
    open: true,
    defaultStrategy: "rebase",
    onConfirm: noop,
    onCancel: noop,
  },
};

export const FfOnly: Story = {
  args: {
    open: true,
    defaultStrategy: "ff-only",
    onConfirm: noop,
    onCancel: noop,
  },
};

export const Pruned: Story = {
  args: {
    open: true,
    defaultPrune: true,
    defaultTags: true,
    onConfirm: noop,
    onCancel: noop,
  },
};
