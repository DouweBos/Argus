import type { Meta, StoryObj } from "@storybook/react";
import * as Icons from "../../icons/Icons";
import { IconBadge } from "./IconBadge";

const meta: Meta<typeof IconBadge> = {
  title: "Components/IconBadge",
  component: IconBadge,
  parameters: { layout: "padded" },
};

export default meta;

type Story = StoryObj<typeof IconBadge>;

export const Sizes: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <IconBadge size="sm">
        <Icons.GearIcon size={11} />
      </IconBadge>
      <IconBadge size="md">
        <Icons.GearIcon size={14} />
      </IconBadge>
      <IconBadge size="lg">
        <Icons.GearIcon size={18} />
      </IconBadge>
    </div>
  ),
};

export const Tones: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 12 }}>
      <IconBadge tone="neutral">
        <Icons.GearIcon size={14} />
      </IconBadge>
      <IconBadge tone="accent">
        <Icons.GearIcon size={14} />
      </IconBadge>
      <IconBadge tone="success">
        <Icons.MergeIcon size={14} />
      </IconBadge>
      <IconBadge tone="warning">
        <Icons.GearIcon size={14} />
      </IconBadge>
      <IconBadge tone="error">
        <Icons.TrashIcon size={14} />
      </IconBadge>
    </div>
  ),
};

export const Project: Story = {
  render: () => (
    <div
      style={
        { ["--project-accent" as string]: "#7dd3fc" } as React.CSSProperties
      }
    >
      <IconBadge size="lg" tone="project">
        <Icons.FolderIcon size={18} />
      </IconBadge>
    </div>
  ),
};
