import type { Meta, StoryObj } from "@storybook/react";
import { HuddleChat } from "./HuddleChat";

const meta: Meta<typeof HuddleChat> = {
  title: "Components/HuddleChat",
  component: HuddleChat,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div style={{ height: 360, display: "flex" }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof HuddleChat>;

const NOON = new Date("2026-09-22T12:00:00").getTime();

export const Empty: Story = {
  args: { messages: [], onSend: () => {} },
};

/** Consecutive lines from one person collapse under a single name. */
export const AConversation: Story = {
  args: {
    onSend: () => {},
    messages: [
      {
        id: "1",
        author: "Chris",
        text: "Can you reproduce this on the iPad?",
        at: NOON,
      },
      {
        id: "2",
        author: "Ana",
        text: "Trying now.",
        at: NOON + 40_000,
        mine: true,
      },
      {
        id: "3",
        author: "Ana",
        text: "Yep — same thing on the second slide.",
        at: NOON + 55_000,
        mine: true,
      },
      {
        id: "4",
        author: "Chris",
        text: "Good. I'll point the agent at the carousel.",
        at: NOON + 90_000,
      },
    ],
  },
};

/** A gap longer than five minutes re-states who is talking. */
export const AfterAPause: Story = {
  args: {
    onSend: () => {},
    messages: [
      { id: "1", author: "Chris", text: "Back in five.", at: NOON },
      {
        id: "2",
        author: "Chris",
        text: "Right — where were we?",
        at: NOON + 900_000,
      },
    ],
  },
};

/** Someone who has been removed from the room can still read what was said. */
export const ReadOnly: Story = {
  args: {
    readOnly: true,
    onSend: () => {},
    messages: [
      { id: "1", author: "Chris", text: "Ending the huddle now.", at: NOON },
    ],
  },
};
