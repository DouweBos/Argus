import type { Meta, StoryObj } from "@storybook/react";
import { Disclosure } from "./Disclosure";

const meta: Meta<typeof Disclosure> = {
  title: "Components/Disclosure",
  component: Disclosure,
  parameters: { layout: "padded" },
};

export default meta;

type Story = StoryObj<typeof Disclosure>;

/** The huddle share disclosure — one line, with the surprising part a click away. */
export const ShareDisclosure: Story = {
  args: {
    summary:
      "Anyone you let in can watch this agent and drive it with you, until you end the huddle.",
    toggleLabel: "What a guest can do",
    children: (
      <ul>
        <li>
          Read the whole conversation — every message you send, the agent&apos;s
          replies, and the files and commands it touches.
        </li>
        <li>Send messages to this agent, exactly like you can.</li>
        <li>
          Approve the agent&apos;s tool calls, which runs code on this Mac.
        </li>
        <li>Drive the device you have open, and take control from you.</li>
        <li>
          Nothing else: your other agents, sessions and projects stay out of
          reach, and their access dies with the huddle.
        </li>
      </ul>
    ),
  },
};

export const OpenByDefault: Story = {
  args: {
    defaultOpen: true,
    summary: "This branch has diverged from its upstream.",
    toggleLabel: "Details",
    children: <p>3 commits ahead, 2 behind. A pull will rebase your work.</p>,
  },
};
