import type { Meta, StoryObj } from "@storybook/react";
import { UnreadDivider } from "./UnreadDivider";

const meta: Meta<typeof UnreadDivider> = {
  title: "Primitives/UnreadDivider",
  component: UnreadDivider,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
};
export default meta;
type Story = StoryObj<typeof UnreadDivider>;

export const Default: Story = {};

export const CustomLabel: Story = { args: { label: "New messages" } };

export const InContext: Story = {
  render: () => (
    <div style={{ width: 480 }}>
      <p style={{ padding: "8px 20px", margin: 0 }}>Earlier message</p>
      <UnreadDivider />
      <p style={{ padding: "8px 20px", margin: 0 }}>First unread message</p>
      <p style={{ padding: "8px 20px", margin: 0 }}>Another unread message</p>
    </div>
  ),
};
