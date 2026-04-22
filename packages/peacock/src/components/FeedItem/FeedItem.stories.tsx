import type { Meta, StoryObj } from "@storybook/react";
import * as Icons from "../../icons/Icons";
import { FeedItem } from "./FeedItem";

const meta: Meta<typeof FeedItem> = {
  title: "Composites/FeedItem",
  component: FeedItem,
  parameters: { layout: "padded" },
};

export default meta;

type Story = StoryObj<typeof FeedItem>;

export const Activity: Story = {
  args: {
    icon: <Icons.AgentStartIcon size={13} />,
    tone: "success",
    chips: (
      <>
        <span>argus</span>
        <span style={{ fontFamily: "var(--font-mono)", textTransform: "none" }}>
          feat/peacock
        </span>
      </>
    ),
    title: "Agent spawned",
    detail: "claude-opus-4-7 started a new session",
    time: "12s",
  },
};

export const NotificationBordered: Story = {
  args: {
    icon: <Icons.WarningIcon size={13} />,
    tone: "error",
    bordered: true,
    chips: (
      <>
        <span style={{ fontWeight: 600 }}>error</span>
        <span style={{ fontFamily: "var(--font-mono)", textTransform: "none" }}>
          workspace
        </span>
      </>
    ),
    title: "Could not create worktree — branch already exists",
    time: "2m",
    trailing: (
      <button
        type="button"
        style={{
          width: 20,
          height: 20,
          border: "none",
          background: "transparent",
          color: "var(--text-muted)",
          cursor: "pointer",
          borderRadius: "var(--border-radius-xs)",
        }}
        aria-label="Dismiss"
      >
        <Icons.CloseIcon size={10} />
      </button>
    ),
  },
};

export const Muted: Story = {
  args: {
    icon: <Icons.TrashIcon size={13} />,
    tone: "muted",
    chips: <span>argus</span>,
    title: "Session deleted",
    time: "5h",
  },
};
