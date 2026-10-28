import type { Meta, StoryObj } from "@storybook/react";
import { AccountMemberList } from "./AccountMemberList";

const meta: Meta<typeof AccountMemberList> = {
  title: "Components/AccountMemberList",
  component: AccountMemberList,
  parameters: { layout: "padded" },
};

export default meta;

type Story = StoryObj<typeof AccountMemberList>;

/** Computers to open: online first, one with no route a browser can use. */
export const Computers: Story = {
  args: {
    members: [
      { id: "a", label: "Studio Mac", detail: "Online", tone: "success" },
      {
        id: "b",
        label: "Mac mini",
        detail: "Last seen 2 h ago",
        tone: "neutral",
      },
      {
        id: "c",
        label: "Build box",
        detail: "Online · no secure route — turn on remote access there",
        tone: "success",
        disabled: true,
      },
    ],
    onSelect: () => {},
  },
};

/** Read-only devices, the current one tagged. */
export const Devices: Story = {
  args: {
    members: [
      {
        id: "w",
        label: "Chrome on Mac",
        detail: "Browser",
        tag: "This browser",
      },
      { id: "p", label: "Douwe's iPhone", detail: "iPhone · added 3 Oct" },
      { id: "m", label: "Studio Mac", detail: "Mac app · added 1 Oct" },
    ],
  },
};

export const Empty: Story = {
  args: {
    members: [],
    emptyText: "No computers on your account yet.",
  },
};
