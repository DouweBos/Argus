import type { Meta, StoryObj } from "@storybook/react";
import { OverflowMenu } from "./OverflowMenu";

const meta: Meta<typeof OverflowMenu> = {
  title: "Primitives/OverflowMenu",
  component: OverflowMenu,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
};
export default meta;
type Story = StoryObj<typeof OverflowMenu>;

const noop = () => {};

export const AccountSubmenu: Story = {
  args: {
    title: "More options, account: Work",
    items: [
      {
        label: "Account",
        description: "Work",
        children: [
          {
            label: "Default account",
            description: "Follows the computer: Personal",
            onClick: noop,
          },
          { label: "Work", description: "Team", selected: true, onClick: noop },
          { label: "Personal", description: "Max", onClick: noop },
        ],
      },
    ],
  },
};
