import type { Meta, StoryObj } from "@storybook/react";
import { BellIcon, GearIcon, RightSidebarIcon } from "../../icons/Icons";
import { FlatIconButton } from "./FlatIconButton";

const meta: Meta<typeof FlatIconButton> = {
  title: "Primitives/FlatIconButton",
  component: FlatIconButton,
  args: { label: "Settings", icon: <GearIcon size={15} /> },
};
export default meta;
type Story = StoryObj<typeof FlatIconButton>;

export const Default: Story = {};

export const States: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <FlatIconButton icon={<GearIcon size={15} />} label="Settings" />
      <FlatIconButton
        selected
        icon={<RightSidebarIcon size={15} />}
        label="Side panel"
      />
      <FlatIconButton
        badge={3}
        icon={<BellIcon size={15} />}
        label="Notifications"
      />
      <FlatIconButton disabled icon={<GearIcon size={15} />} label="Disabled" />
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      {(["sm", "md", "lg"] as const).map((size) => (
        <FlatIconButton
          key={size}
          icon={<GearIcon size={size === "sm" ? 13 : 15} />}
          label={size}
          size={size}
        />
      ))}
    </div>
  ),
};
