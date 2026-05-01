import type { Meta, StoryObj } from "@storybook/react";
import { TagDialog } from "./TagDialog";

const meta: Meta<typeof TagDialog> = {
  title: "Git/TagDialog",
  component: TagDialog,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof TagDialog>;

const noop = () => undefined;

export const Create: Story = {
  args: {
    open: true,
    mode: "create",
    defaultName: "v1.0.0",
    onConfirm: noop,
    onCancel: noop,
  },
};

export const CreateAnnotated: Story = {
  args: {
    open: true,
    mode: "create",
    defaultName: "v2.0.0",
    onConfirm: noop,
    onCancel: noop,
  },
};

export const Delete: Story = {
  args: {
    open: true,
    mode: "delete",
    defaultName: "v0.9.0",
    onConfirm: noop,
    onCancel: noop,
  },
};

export const WithRefPicker: Story = {
  args: {
    open: true,
    mode: "create",
    defaultName: "release/2026.04",
    refOptions: ["main", "develop", "release/2026.03", "feature/git-client"],
    onConfirm: noop,
    onCancel: noop,
  },
};
