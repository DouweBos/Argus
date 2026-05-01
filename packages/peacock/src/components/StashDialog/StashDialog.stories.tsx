import type { Meta, StoryObj } from "@storybook/react";
import { StashDialog } from "./StashDialog";

const meta: Meta<typeof StashDialog> = {
  title: "Git/StashDialog",
  component: StashDialog,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof StashDialog>;

const noop = () => undefined;

export const Default: Story = {
  args: {
    open: true,
    onConfirm: noop,
    onCancel: noop,
  },
};

export const WithMessage: Story = {
  args: {
    open: true,
    defaultMessage: "WIP refactor of stash dialog",
    onConfirm: noop,
    onCancel: noop,
  },
};

export const AllOptionsOn: Story = {
  args: {
    open: true,
    defaultMessage: "WIP including untracked + staged",
    defaultIncludeUntracked: true,
    defaultKeepIndex: true,
    onConfirm: noop,
    onCancel: noop,
  },
};
