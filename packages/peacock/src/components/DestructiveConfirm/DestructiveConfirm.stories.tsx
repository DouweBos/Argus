import type { Meta, StoryObj } from "@storybook/react";
import { DestructiveConfirm } from "./DestructiveConfirm";

const meta: Meta<typeof DestructiveConfirm> = {
  title: "Git/DestructiveConfirm",
  component: DestructiveConfirm,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof DestructiveConfirm>;

const noop = () => undefined;

export const Default: Story = {
  args: {
    open: true,
    title: "Drop stash?",
    description: "This permanently removes the stash. Cannot be undone.",
    confirmLabel: "Drop stash",
    onCancel: noop,
    onConfirm: noop,
  },
};

export const WithRemember: Story = {
  args: {
    open: true,
    title: "Discard changes?",
    description: "All uncommitted edits in this file will be lost.",
    confirmLabel: "Discard",
    rememberKey: "discard-file",
    rememberLabel: "discarding files",
    onCancel: noop,
    onConfirm: noop,
  },
};

export const Warning: Story = {
  args: {
    open: true,
    title: "Force push?",
    description:
      "This rewrites history on the remote. Collaborators may lose work.",
    confirmLabel: "Force push",
    tone: "warning",
    onCancel: noop,
    onConfirm: noop,
  },
};

export const LongDescription: Story = {
  args: {
    open: true,
    title: "Reset branch?",
    description:
      "Reset will move HEAD back. Files in the working tree are kept (mixed reset). " +
      "Any commits that no longer have a ref pointing at them become unreachable and " +
      "will eventually be garbage collected. Use the reflog to recover.",
    confirmLabel: "Reset",
    onCancel: noop,
    onConfirm: noop,
  },
};
