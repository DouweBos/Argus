import type { Meta, StoryObj } from "@storybook/react";
import { RefBadgeList } from "./RefBadgeList";

const meta: Meta<typeof RefBadgeList> = {
  title: "Git/RefBadgeList",
  component: RefBadgeList,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Compact tag-icon trigger that reveals all refs (branches, tags, HEAD) attached to a commit on hover. Use when row width is too tight to render full RefBadges inline.",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof RefBadgeList>;

export const Single: Story = {
  args: {
    items: [{ name: "origin/main", type: "remote-branch" }],
  },
};

export const Many: Story = {
  args: {
    items: [
      { name: "main", type: "local-branch", current: true },
      { name: "origin/main", type: "remote-branch" },
      { name: "origin/adam/PLAY-738-feature", type: "remote-branch" },
      { name: "v1.4.2", type: "tag" },
      { name: "release", type: "tag" },
    ],
  },
};

export const TagsOnly: Story = {
  args: {
    items: [
      { name: "v2.0.0", type: "tag" },
      { name: "v2.0.0-rc.1", type: "tag" },
    ],
  },
};
