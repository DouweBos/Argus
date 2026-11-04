import type { Meta, StoryObj } from "@storybook/react";
import { AccountMemberActions } from "../AccountMemberActions/AccountMemberActions";
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

const settle = () => new Promise((resolve) => setTimeout(resolve, 600));
const actions = (name: string, canRemove = true) => (
  <AccountMemberActions
    name={name}
    canRename
    canRemove={canRemove}
    onRename={settle}
    onRemove={settle}
    onError={() => {}}
  />
);

/** Devices you can rename and remove; this one leaves through Sign out. */
export const ManagedDevices: Story = {
  args: {
    members: [
      {
        id: "w",
        label: "Chrome on Mac",
        detail: "Browser",
        tag: "This browser",
        actions: actions("Chrome on Mac", false),
      },
      {
        id: "p",
        label: "Douwe's iPhone",
        detail: "iPhone · added 3 Oct",
        actions: actions("Douwe's iPhone"),
      },
    ],
  },
};

export const Empty: Story = {
  args: {
    members: [],
    emptyText: "No computers on your account yet.",
  },
};
