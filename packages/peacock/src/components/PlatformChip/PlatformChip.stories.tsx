import type { Meta, StoryObj } from "@storybook/react";
import { PlatformChip } from "./PlatformChip";

const meta: Meta<typeof PlatformChip> = {
  title: "Primitives/PlatformChip",
  component: PlatformChip,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof PlatformChip>;

export const All: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <PlatformChip platform="ios" />
      <PlatformChip platform="android" />
      <PlatformChip platform="web" />
      <PlatformChip platform="desktop" />
    </div>
  ),
};
