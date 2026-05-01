import type { Meta, StoryObj } from "@storybook/react";
import { Avatar } from "./Avatar";

const meta: Meta<typeof Avatar> = {
  title: "Primitives/Avatar",
  component: Avatar,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof Avatar>;

export const Initials: Story = {
  args: { name: "Douwe Bos", size: 32 },
};

export const Gravatar: Story = {
  args: {
    name: "Octocat",
    size: 32,
    src: "https://www.gravatar.com/avatar/00000000000000000000000000000000?s=64&d=identicon",
  },
};

export const FallsBackOnError: Story = {
  args: {
    name: "Ada Lovelace",
    size: 32,
    src: "https://invalid.example.com/missing.png",
  },
};

export const Small: Story = {
  args: { name: "Alex Stevens", size: 18 },
};

export const Large: Story = {
  args: { name: "Craig Hopper", size: 48 },
};
