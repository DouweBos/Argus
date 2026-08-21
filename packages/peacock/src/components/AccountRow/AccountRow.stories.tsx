import type { Meta, StoryObj } from "@storybook/react";
import { AccountRow } from "./AccountRow";

const meta: Meta<typeof AccountRow> = {
  title: "Primitives/AccountRow",
  component: AccountRow,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof AccountRow>;

export const Active: Story = {
  args: {
    label: "douwe@douwebos.nl",
    detail: "Houwert.dev",
    plan: "Max",
    active: true,
    onRename: () => {},
  },
};

export const Inactive: Story = {
  args: {
    label: "Work account",
    detail: "work@example.com · Acme Inc",
    plan: "Team",
    onSelect: () => {},
    onRename: () => {},
    onRemove: () => {},
  },
};

export const Minimal: Story = {
  args: {
    label: "Signing in…",
    onRemove: () => {},
  },
};

export const Busy: Story = {
  args: {
    label: "Work account",
    detail: "work@example.com",
    plan: "Pro",
    busy: true,
    onSelect: () => {},
    onRename: () => {},
    onRemove: () => {},
  },
};

export const NeedsReauth: Story = {
  args: {
    label: "work@example.com",
    detail: "Acme Inc",
    plan: "Team",
    needsReauth: true,
    onReauth: () => {},
    onSelect: () => {},
    onRename: () => {},
    onRemove: () => {},
  },
};

export const List: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <AccountRow
        active
        label="douwe@douwebos.nl"
        detail="Personal"
        plan="Max"
        onRename={() => {}}
      />
      <AccountRow
        label="work@example.com"
        detail="Acme Inc"
        plan="Team"
        onSelect={() => {}}
        onRename={() => {}}
        onRemove={() => {}}
      />
    </div>
  ),
};
