import type { Meta, StoryObj } from "@storybook/react";
import { PullRequestState } from "./PullRequestState";

const meta: Meta<typeof PullRequestState> = {
  title: "Primitives/PullRequestState",
  component: PullRequestState,
  tags: ["autodocs"],
  args: { number: 123 },
};
export default meta;
type Story = StoryObj<typeof PullRequestState>;

export const Open: Story = { args: { state: "open" } };
export const Draft: Story = { args: { state: "draft" } };
export const Merged: Story = { args: { state: "merged" } };
export const Closed: Story = { args: { state: "closed" } };

export const Clickable: Story = {
  args: { state: "open", onOpen: () => undefined },
};

export const AllStates: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 12 }}>
      <PullRequestState number={1} state="open" />
      <PullRequestState number={2} state="draft" />
      <PullRequestState number={3} state="merged" />
      <PullRequestState number={4} state="closed" />
    </div>
  ),
};
