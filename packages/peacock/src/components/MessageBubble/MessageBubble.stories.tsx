import type { Meta, StoryObj } from "@storybook/react";
import { MessageBubble } from "./MessageBubble";

const meta: Meta<typeof MessageBubble> = {
  title: "Chat/MessageBubble",
  component: MessageBubble,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof MessageBubble>;

export const User: Story = {
  args: {
    role: "user",
    timestamp: Date.parse("2026-07-12T10:00:00Z"),
    textBlocks: ["Can you migrate the chat into Peacock?"],
  },
};

/** A message a huddle guest sent, attributed so the room knows who spoke. */
export const UserFromGuest: Story = {
  args: {
    role: "user",
    author: "Sam Rivera",
    timestamp: Date.parse("2026-07-12T10:00:30Z"),
    textBlocks: ["Try tapping the second tab — it crashes for me."],
  },
};

export const Assistant: Story = {
  args: {
    role: "assistant",
    timestamp: Date.parse("2026-07-12T10:01:00Z"),
    textBlocks: ["On it — here's the **plan** with a `code` snippet."],
  },
};

export const System: Story = {
  args: { role: "system", textBlocks: ["API retry 1/3 — retrying in 2s"] },
};

export const Mcp: Story = {
  args: {
    role: "system",
    mcp: { label: "argus → spawn_agent" },
    textBlocks: ["Spawned a sub-agent to investigate the failing test."],
  },
};
