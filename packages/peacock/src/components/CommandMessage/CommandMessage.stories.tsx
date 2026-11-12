import type { Meta, StoryObj } from "@storybook/react";
import { MessageBubble } from "../MessageBubble/MessageBubble";
import { CommandMessage } from "./CommandMessage";

const meta: Meta<typeof CommandMessage> = {
  title: "Chat/CommandMessage",
  component: CommandMessage,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "One of the runner's own slash commands in a sent message, drawn in a user bubble through `MessageBubble`'s `content`: the command as a chip, whatever followed it as text.",
      },
    },
  },
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

/** `/compact keep the plan` */
export const WithArgs: Story = {
  args: { name: "compact", args: "keep the plan" },
};

/** `/review` */
export const NameOnly: Story = {
  args: { name: "review" },
};
