import type { Meta, StoryObj } from "@storybook/react";
import { LabelChip } from "./LabelChip";

const meta: Meta<typeof LabelChip> = {
  title: "Components/LabelChip",
  component: LabelChip,
};

export default meta;

type Story = StoryObj<typeof LabelChip>;

export const Colored: Story = { args: { name: "GROW", color: "#4cb782" } };

export const NoColor: Story = { args: { name: "Bug" } };
