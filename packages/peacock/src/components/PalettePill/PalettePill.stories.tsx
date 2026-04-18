import type { Meta, StoryObj } from "@storybook/react";
import { PalettePill } from "./PalettePill";

const meta: Meta<typeof PalettePill> = {
  title: "Composites/PalettePill",
  component: PalettePill,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof PalettePill>;

export const Default: Story = {
  render: () => (
    <div style={{ width: 560 }}>
      <PalettePill />
    </div>
  ),
};
