import type { Meta, StoryObj } from "@storybook/react";
import { AccountMemberActions } from "./AccountMemberActions";

const meta: Meta<typeof AccountMemberActions> = {
  title: "Components/AccountMemberActions",
  component: AccountMemberActions,
  parameters: { layout: "padded" },
  args: {
    name: "Mac mini",
    canRename: true,
    canRemove: true,
    onRename: () => new Promise((resolve) => setTimeout(resolve, 600)),
    onRemove: () => new Promise((resolve) => setTimeout(resolve, 600)),
    onError: () => {},
  },
};

export default meta;

type Story = StoryObj<typeof AccountMemberActions>;

/** Rename opens an inline field; Remove asks first. */
export const RenameAndRemove: Story = {};

/** This device: it can rename itself, and leaves through Sign out instead. */
export const RenameOnly: Story = { args: { canRemove: false } };

/** A change the account service refused. */
export const Failing: Story = {
  args: {
    onRename: () =>
      Promise.reject(new Error("The account service refused the change.")),
    onRemove: () =>
      Promise.reject(new Error("The account service refused the change.")),
  },
};
