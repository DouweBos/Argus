import type { Meta, StoryObj } from "@storybook/react";
import { ColorSwatch } from "./ColorSwatch";

const meta: Meta<typeof ColorSwatch> = {
  title: "Primitives/ColorSwatch",
  component: ColorSwatch,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof ColorSwatch>;

export const Opaque: Story = {
  args: { color: "#3B82F6FF" },
};

export const PartialAlpha: Story = {
  args: { color: "#FF3B3080" },
};

export const ChipOnly: Story = {
  args: { color: "#22C55EFF", showValue: false },
};

export const Rows: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <ColorSwatch color="#FFFFFFFF" />
      <ColorSwatch color="#000000FF" />
      <ColorSwatch color="#3B82F6CC" />
      <ColorSwatch color="#FACC1500" />
    </div>
  ),
};
