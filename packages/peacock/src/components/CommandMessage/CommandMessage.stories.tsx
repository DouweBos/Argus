import type { Meta, StoryObj } from "@storybook/react";
import { MessageBubble } from "../MessageBubble/MessageBubble";
import { CommandMessage } from "./CommandMessage";

const PLAYBOOK = `# Implement ENG-273, and prove it

You are done only when every acceptance criterion has evidence taken after your last code change.

## 1. Read the ticket

Read **ENG-273** with \`linear_get_issue\` and open every Figma frame it links.

## 2. Write the acceptance criteria

- One line per criterion
- Each one testable on a device

## From the user

keep the header as it is`;

const meta: Meta<typeof CommandMessage> = {
  title: "Chat/CommandMessage",
  component: CommandMessage,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "A slash command in a sent message, drawn in a user bubble through `MessageBubble`'s `content`. An Argus command carries the playbook it expanded into behind a disclosure.",
      },
    },
  },
  args: { onPlaybookOpenChange: () => {} },
  render: (args) => (
    <MessageBubble
      content={<CommandMessage {...args} />}
      role="user"
      textBlocks={[]}
      timestamp={Date.parse("2026-11-12T10:00:00Z")}
    />
  ),
};

export default meta;

type Story = StoryObj<typeof CommandMessage>;

/** `/implement-ticket ENG-273 keep the header`, playbook folded. */
export const ArgusCommand: Story = {
  args: {
    name: "implement-ticket",
    argument: "ENG-273",
    notes: "keep the header as it is",
    prompt: PLAYBOOK,
  },
};

export const PlaybookOpen: Story = {
  args: { ...ArgusCommand.args, defaultPlaybookOpen: true },
};

/** The ticket opens the issue screen. */
export const TicketLink: Story = {
  args: {
    ...ArgusCommand.args,
    argumentLink: { href: "/issues/ENG-273", onClick: () => {} },
  },
};

/** A URL that isn't an issue opens in a new tab. */
export const ExternalLink: Story = {
  args: {
    ...ArgusCommand.args,
    argument: "https://github.com/acme/web/issues/42",
    argumentLink: {
      href: "https://github.com/acme/web/issues/42",
      external: true,
    },
  },
};

/** The runner's own command, passed through: no playbook. */
export const RunnerCommand: Story = {
  args: { name: "compact", notes: "keep the plan" },
};

export const NoArgument: Story = {
  args: { name: "implement-ticket", prompt: PLAYBOOK },
};
