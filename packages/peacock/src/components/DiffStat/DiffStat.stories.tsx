import type { Meta, StoryObj } from "@storybook/react";
import { DiffStat } from "./DiffStat";

const meta: Meta<typeof DiffStat> = {
  title: "Primitives/DiffStat",
  component: DiffStat,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof DiffStat>;

export const Default: Story = { args: { added: 124, removed: 37, files: 8 } };
