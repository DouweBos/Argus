import type { Meta, StoryObj } from "@storybook/react";
import * as Icons from "../../icons/Icons";
import { ContextMenu } from "./ContextMenu";

const meta: Meta<typeof ContextMenu> = {
  title: "Primitives/ContextMenu",
  component: ContextMenu,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
};
export default meta;
type Story = StoryObj<typeof ContextMenu>;

const noop = () => {};

export const Anchor: Story = {
  render: (args) => (
    <div style={{ position: "relative", width: 240, height: 260 }}>
      <ContextMenu {...args} />
    </div>
  ),
  args: {
    position: "anchor",
    onClose: noop,
    items: [
      {
        icon: <Icons.CopyIcon size={12} />,
        label: "Copy Absolute Path",
        onClick: noop,
      },
      {
        icon: <Icons.CopyIcon size={12} />,
        label: "Copy Relative Path",
        onClick: noop,
      },
      {
        icon: <Icons.BranchIcon size={12} />,
        label: "Copy Branch Name",
        onClick: noop,
      },
      { separator: true },
      {
        icon: <Icons.FolderIcon size={12} />,
        label: "Reveal in Finder",
        onClick: noop,
      },
      {
        icon: <Icons.TerminalIcon size={12} />,
        label: "Open in Terminal",
        onClick: noop,
      },
    ],
  },
};

export const WithDanger: Story = {
  render: (args) => (
    <div style={{ position: "relative", width: 240, height: 220 }}>
      <ContextMenu {...args} />
    </div>
  ),
  args: {
    position: "anchor",
    onClose: noop,
    items: [
      {
        icon: <Icons.CopyIcon size={12} />,
        label: "Copy Absolute Path",
        onClick: noop,
      },
      { separator: true },
      {
        icon: <Icons.TrashIcon size={12} />,
        label: "Delete Workspace",
        onClick: noop,
        danger: true,
      },
    ],
  },
};

export const NoIcons: Story = {
  render: (args) => (
    <div style={{ position: "relative", width: 240, height: 180 }}>
      <ContextMenu {...args} />
    </div>
  ),
  args: {
    position: "anchor",
    onClose: noop,
    items: [
      { label: "Rename", onClick: noop },
      { label: "Duplicate", onClick: noop },
      { separator: true },
      { label: "Remove", onClick: noop, danger: true },
    ],
  },
};
