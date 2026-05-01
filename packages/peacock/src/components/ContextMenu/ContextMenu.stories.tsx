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

const centeredPosition = { x: 200, y: 120 };

export const Default: Story = {
  render: (args) => (
    <div style={{ width: 240, height: 300 }}>
      <ContextMenu {...args} />
    </div>
  ),
  args: {
    position: centeredPosition,
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
    <div style={{ width: 240, height: 260 }}>
      <ContextMenu {...args} />
    </div>
  ),
  args: {
    position: centeredPosition,
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
        label: "Delete Session",
        onClick: noop,
        danger: true,
      },
    ],
  },
};

export const NestedSubmenus: Story = {
  render: (args) => (
    <div style={{ width: 360, height: 320 }}>
      <ContextMenu {...args} />
    </div>
  ),
  args: {
    position: centeredPosition,
    onClose: noop,
    items: [
      { label: "Profile", trailing: "myapp://profile/123", onClick: noop },
      {
        label: "Onboarding",
        icon: <Icons.FolderIcon size={12} />,
        children: [
          { label: "Welcome", trailing: "myapp://onboarding", onClick: noop },
          {
            label: "Sign up",
            trailing: "myapp://onboarding/signup",
            onClick: noop,
          },
          {
            label: "Verify",
            icon: <Icons.FolderIcon size={12} />,
            children: [
              {
                label: "Email",
                trailing: "myapp://onboarding/verify/email",
                onClick: noop,
              },
              {
                label: "Phone",
                trailing: "myapp://onboarding/verify/phone",
                onClick: noop,
              },
            ],
          },
        ],
      },
      {
        label: "Checkout",
        icon: <Icons.FolderIcon size={12} />,
        children: [
          { label: "Cart", trailing: "myapp://checkout", onClick: noop },
          { label: "Payment", trailing: "myapp://checkout/pay", onClick: noop },
        ],
      },
      { separator: true },
      { label: "Open docs", trailing: "https://docs", onClick: noop },
    ],
  },
};

export const NoIcons: Story = {
  render: (args) => (
    <div style={{ width: 240, height: 220 }}>
      <ContextMenu {...args} />
    </div>
  ),
  args: {
    position: centeredPosition,
    onClose: noop,
    items: [
      { label: "Rename", onClick: noop },
      { label: "Duplicate", onClick: noop },
      { separator: true },
      { label: "Remove", onClick: noop, danger: true },
    ],
  },
};
