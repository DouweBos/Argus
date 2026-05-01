import type { Meta, StoryObj } from "@storybook/react";
import { RemoteDialog } from "./RemoteDialog";

const meta: Meta<typeof RemoteDialog> = {
  title: "Git/RemoteDialog",
  component: RemoteDialog,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof RemoteDialog>;

const noop = () => undefined;

export const Add: Story = {
  args: {
    open: true,
    mode: "add",
    onConfirm: noop,
    onCancel: noop,
  },
};

export const Edit: Story = {
  args: {
    open: true,
    mode: "edit",
    defaultName: "origin",
    defaultFetchUrl: "git@github.com:acme/argus.git",
    onConfirm: noop,
    onCancel: noop,
  },
};

export const WithSeparatePushUrl: Story = {
  args: {
    open: true,
    mode: "edit",
    defaultName: "upstream",
    defaultFetchUrl: "https://github.com/upstream/argus.git",
    defaultPushUrl: "git@github.com:upstream/argus.git",
    onConfirm: noop,
    onCancel: noop,
  },
};

export const ValidationError: Story = {
  args: {
    open: true,
    mode: "add",
    defaultName: "origin",
    defaultFetchUrl: "not-a-url",
    validationError: "URL must look like a git remote (https://… or git@…).",
    onConfirm: noop,
    onCancel: noop,
  },
};
