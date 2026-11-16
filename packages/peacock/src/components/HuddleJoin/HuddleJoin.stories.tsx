import type { Meta, StoryObj } from "@storybook/react";
import { LockIcon } from "../../icons/Icons";
import { Button } from "../Button/Button";
import { EmptyState } from "../EmptyState/EmptyState";
import { HuddleJoin, HuddleJoinShell } from "./HuddleJoin";

const meta: Meta<typeof HuddleJoin> = {
  title: "Components/HuddleJoin",
  component: HuddleJoin,
  parameters: { layout: "fullscreen" },
};

export default meta;

type Story = StoryObj<typeof HuddleJoin>;

/** First visit: no name yet, so the preview shows a placeholder. */
export const AskForName: Story = {
  render: () => (
    <HuddleJoinShell>
      <HuddleJoin step="name" onJoin={() => {}} />
    </HuddleJoinShell>
  ),
};

/** A returning guest: the name they used last time is filled in. */
export const Prefilled: Story = {
  render: () => (
    <HuddleJoinShell>
      <HuddleJoin name="Sam Rivera" step="name" onJoin={() => {}} />
    </HuddleJoinShell>
  ),
};

/** Asked; the host hasn't decided yet. */
export const Waiting: Story = {
  render: () => (
    <HuddleJoinShell>
      <HuddleJoin name="Sam Rivera" step="waiting" />
    </HuddleJoinShell>
  ),
};

export const Connecting: Story = {
  render: () => (
    <HuddleJoinShell>
      <HuddleJoin step="connecting" />
    </HuddleJoinShell>
  ),
};

/** The end states reuse the shell around an EmptyState. */
export const Denied: Story = {
  render: () => (
    <HuddleJoinShell>
      <EmptyState
        action={<Button variant="primary">Ask to rejoin</Button>}
        body="The host turned down this request."
        icon={<LockIcon size={22} />}
        title="Not let in"
      />
    </HuddleJoinShell>
  ),
};
