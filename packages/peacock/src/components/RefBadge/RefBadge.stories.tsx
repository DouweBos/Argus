import type { Meta, StoryObj } from "@storybook/react";
import { RefBadge } from "./RefBadge";

const meta: Meta<typeof RefBadge> = {
  title: "Git/RefBadge",
  component: RefBadge,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof RefBadge>;

export const LocalBranch: Story = {
  args: { name: "feature/login-flow", type: "local-branch" },
};

export const RemoteBranch: Story = {
  args: { name: "origin/feature/login-flow", type: "remote-branch" },
};

export const Tag: Story = {
  args: { name: "v1.4.2", type: "tag" },
};

export const Head: Story = {
  args: { name: "HEAD", type: "head" },
};

export const Stash: Story = {
  args: { name: "stash@{0}: WIP on main", type: "stash" },
};

export const Current: Story = {
  args: { name: "main", type: "local-branch", current: true },
};

export const LongName: Story = {
  args: {
    name: "feature/very-long-branch-name-that-overflows-and-should-be-truncated",
    type: "local-branch",
  },
};

export const SmallSize: Story = {
  args: { name: "main", type: "local-branch", size: "sm" },
};
