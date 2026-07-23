import type { Meta, StoryObj } from "@storybook/react";
import * as Icons from "../../icons/Icons";
import {
  QueuedMessage,
  QueuedMessageAction,
  QueuedMessageList,
} from "./QueuedMessage";

const meta: Meta<typeof QueuedMessageList> = {
  title: "Chat/QueuedMessage",
  component: QueuedMessageList,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
};
export default meta;
type Story = StoryObj<typeof QueuedMessageList>;

const noop = () => {};

export const Single: Story = {
  render: () => (
    <QueuedMessageList>
      <QueuedMessage
        text="Run the tests once you're done refactoring."
        actions={
          <QueuedMessageAction
            icon={<Icons.CloseIcon size={12} />}
            label="Remove"
            onClick={noop}
          />
        }
      />
    </QueuedMessageList>
  ),
};

export const Multiple: Story = {
  render: () => (
    <QueuedMessageList>
      {["First follow-up message", "Then this one", "And finally this"].map(
        (t) => (
          <QueuedMessage
            key={t}
            text={t}
            actions={
              <QueuedMessageAction
                icon={<Icons.CloseIcon size={12} />}
                label="Remove"
                onClick={noop}
              />
            }
          />
        ),
      )}
    </QueuedMessageList>
  ),
};

export const WithEditAndDelete: Story = {
  render: () => (
    <QueuedMessageList>
      <QueuedMessage
        text="A queued message with edit + delete actions."
        actions={
          <>
            <QueuedMessageAction
              icon={<Icons.PencilIcon size={11} />}
              label="Edit"
              onClick={noop}
            />
            <QueuedMessageAction
              icon={<Icons.TrashIcon size={12} />}
              label="Delete"
              onClick={noop}
            />
          </>
        }
      />
    </QueuedMessageList>
  ),
};
