import type { Meta, StoryObj } from "@storybook/react";
import { FileTypeBadge } from "./FileTypeBadge";

const meta: Meta<typeof FileTypeBadge> = {
  title: "Primitives/FileTypeBadge",
  component: FileTypeBadge,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof FileTypeBadge>;

export const Samples: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
      <FileTypeBadge color="#61afef" label="TS" size={20} />
      <FileTypeBadge color="#e5c07b" label="JS" size={20} />
      <FileTypeBadge color="#98c379" label="CSS" size={20} />
      <FileTypeBadge color="#c678dd" label="MD" size={20} />
      <FileTypeBadge color="#e06c75" label="JSON" size={20} />
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
      <FileTypeBadge color="#61afef" label="TS" size={12} />
      <FileTypeBadge color="#61afef" label="TS" size={16} />
      <FileTypeBadge color="#61afef" label="TS" size={24} />
      <FileTypeBadge color="#61afef" label="TS" size={32} />
    </div>
  ),
};
