import type { Meta, StoryObj } from "@storybook/react";
import { ResetDialog } from "./ResetDialog";

const meta: Meta<typeof ResetDialog> = {
  title: "Git/ResetDialog",
  component: ResetDialog,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof ResetDialog>;

const noop = () => undefined;

export const Soft: Story = {
  args: {
    open: true,
    targetRef: "abc1234",
    targetSubject: "feat: implement git client",
    defaultMode: "soft",
    onConfirm: noop,
    onCancel: noop,
  },
};

export const Mixed: Story = {
  args: {
    open: true,
    targetRef: "abc1234",
    targetSubject: "feat: implement git client",
    defaultMode: "mixed",
    onConfirm: noop,
    onCancel: noop,
  },
};

export const Hard: Story = {
  args: {
    open: true,
    targetRef: "abc1234",
    targetSubject: "feat: implement git client",
    defaultMode: "hard",
    onConfirm: noop,
    onCancel: noop,
  },
};
