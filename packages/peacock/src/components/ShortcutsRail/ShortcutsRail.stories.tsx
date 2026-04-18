import type { Meta, StoryObj } from "@storybook/react";
import { ShortcutsRail } from "./ShortcutsRail";

const meta: Meta<typeof ShortcutsRail> = {
  title: "Composites/ShortcutsRail",
  component: ShortcutsRail,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof ShortcutsRail>;

export const Default: Story = {
  args: {
    shortcuts: [
      { keys: ["⌘", "O"], label: "Open repo" },
      { keys: ["⌘", "N"], label: "New workspace" },
      { keys: ["⌘", "K"], label: "Command palette" },
      { keys: ["⌘", "⇧", "A"], label: "New agent" },
    ],
  },
};
