import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./Button";
import { SendIcon, PlusIcon } from "../../icons/Icons";

const meta: Meta<typeof Button> = {
  title: "Primitives/Button",
  component: Button,
  tags: ["autodocs"],
};
export default meta;

type Story = StoryObj<typeof Button>;

export const Primary: Story = { args: { children: "Open", variant: "primary" } };
export const Secondary: Story = { args: { children: "Allow all", variant: "secondary" } };
export const Ghost: Story = { args: { children: "Deny", variant: "ghost" } };
export const Danger: Story = { args: { children: "Restart", variant: "danger" } };

export const Send: Story = {
  args: { variant: "send", children: <SendIcon size={13} />, "aria-label": "Send" },
};

export const WithLeading: Story = {
  args: {
    variant: "secondary",
    leading: <PlusIcon size={12} />,
    children: "New workspace",
  },
};

export const Row: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <Button variant="primary">Open</Button>
      <Button variant="secondary">Allow all</Button>
      <Button variant="ghost">Deny</Button>
      <Button variant="danger">Restart</Button>
      <Button variant="send" aria-label="Send"><SendIcon size={13} /></Button>
    </div>
  ),
};
