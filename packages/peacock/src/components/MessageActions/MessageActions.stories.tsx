import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { MessageBubble } from "../MessageBubble/MessageBubble";
import { MessageActions, MessageEditForm } from "./MessageActions";

const meta: Meta<typeof MessageActions> = {
  title: "Components/MessageActions",
  component: MessageActions,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "A message's copy / edit / restore / fork buttons, for MessageBubble's `actions` slot (revealed on hover), and the in-place editor an edit opens.",
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof MessageActions>;

const noop = () => {};

export const OnYourMessage: Story = {
  render: () => (
    <MessageBubble
      actions={<MessageActions onCopy={noop} onEdit={noop} onFork={noop} />}
      role="user"
      textBlocks={["Make the login form validate on blur."]}
      timestamp={Date.now()}
    />
  ),
};

export const OnAReply: Story = {
  render: () => (
    <MessageBubble
      actions={<MessageActions onCopy={noop} onFork={noop} />}
      role="assistant"
      textBlocks={["Done — validation now runs when the field loses focus."]}
    />
  ),
};

export const CopyOnly: Story = {
  render: () => (
    <MessageBubble
      actions={<MessageActions onCopy={noop} />}
      role="assistant"
      textBlocks={["A finished chat can still be copied from."]}
    />
  ),
};

export const WithRestore: Story = {
  render: () => (
    <MessageBubble
      actions={
        <MessageActions
          onCopy={noop}
          onEdit={noop}
          onFork={noop}
          onRestore={noop}
        />
      }
      role="user"
      textBlocks={["Undo everything after this."]}
    />
  ),
};

export const Editing: StoryObj<typeof MessageEditForm> = {
  render: () => (
    <MessageEditForm
      hint="The chat rewinds to this message; everything after it is discarded."
      initialText="Make the login form validate on blur."
      saveLabel="Edit & restore"
      timestamp={Date.now()}
      onCancel={noop}
      onSave={noop}
    />
  ),
};

export const EditFailed: StoryObj<typeof MessageEditForm> = {
  render: () => (
    <MessageEditForm
      error="The computer didn't answer in time."
      initialText="Make the login form validate on blur."
      saveLabel="Edit & restore"
      onCancel={noop}
      onSave={noop}
    />
  ),
};

export const EditThenSave: StoryObj<typeof MessageEditForm> = {
  render: () => {
    const [text, setText] = useState("Make the login form validate on blur.");
    const [editing, setEditing] = useState(true);

    return editing ? (
      <MessageEditForm
        initialText={text}
        onCancel={() => setEditing(false)}
        onSave={(next) => {
          setText(next);
          setEditing(false);
        }}
      />
    ) : (
      <MessageBubble
        actions={<MessageActions onEdit={() => setEditing(true)} />}
        role="user"
        textBlocks={[text]}
      />
    );
  },
};
