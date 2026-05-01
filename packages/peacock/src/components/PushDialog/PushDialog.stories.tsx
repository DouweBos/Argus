import type { Meta, StoryObj } from "@storybook/react";
import { PushDialog } from "./PushDialog";

const meta: Meta<typeof PushDialog> = {
  title: "Git/PushDialog",
  component: PushDialog,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof PushDialog>;

const noop = () => undefined;

export const Default: Story = {
  args: {
    open: true,
    currentBranch: "feature/git-client",
    remotes: ["origin"],
    hasUpstream: true,
    onConfirm: noop,
    onCancel: noop,
  },
};

export const NoUpstream: Story = {
  args: {
    open: true,
    currentBranch: "feature/git-client",
    remotes: ["origin", "fork"],
    hasUpstream: false,
    onConfirm: noop,
    onCancel: noop,
  },
};

export const ForceWithLease: Story = {
  args: {
    open: true,
    currentBranch: "feature/git-client",
    remotes: ["origin"],
    hasUpstream: true,
    forceConfirmStage: true,
    onConfirm: noop,
    onCancel: noop,
  },
};

export const WithTags: Story = {
  args: {
    open: true,
    currentBranch: "release/2026.04",
    remotes: ["origin", "github"],
    hasUpstream: true,
    defaultTags: "all",
    onConfirm: noop,
    onCancel: noop,
  },
};
