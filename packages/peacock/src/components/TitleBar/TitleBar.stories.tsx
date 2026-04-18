import type { Meta, StoryObj } from "@storybook/react";
import { TitleBar } from "./TitleBar";

const meta: Meta<typeof TitleBar> = {
  title: "Composites/TitleBar",
  component: TitleBar,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof TitleBar>;

export const Default: Story = {
  args: {
    title: "Argus — home",
    onJump: () => {},
    onToggleLeft: () => {},
    onToggleRight: () => {},
  },
};
