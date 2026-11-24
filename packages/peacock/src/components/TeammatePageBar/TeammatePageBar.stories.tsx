import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../Button/Button";
import { TeammatePageBar } from "./TeammatePageBar";

const meta: Meta<typeof TeammatePageBar> = {
  title: "Automations/TeammatePageBar",
  component: TeammatePageBar,
  tags: ["autodocs"],
  args: { page: "chat", onPage: () => undefined },
};
export default meta;
type Story = StoryObj<typeof TeammatePageBar>;

export const Conversation: Story = {
  args: {
    actions: (
      <>
        <Button size="sm" variant="secondary">
          Conversations
        </Button>
        <Button size="sm">New conversation</Button>
      </>
    ),
  },
};

export const Profile: Story = {
  args: {
    page: "profile",
    actions: (
      <>
        <Button size="sm" variant="ghost">
          Delete
        </Button>
        <Button size="sm">Save</Button>
      </>
    ),
  },
};

export const NoActions: Story = { args: { page: "memory" } };
