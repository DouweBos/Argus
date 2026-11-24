import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../Button/Button";
import { TeammateRow } from "./TeammateRow";

const meta: Meta<typeof TeammateRow> = {
  title: "Primitives/TeammateRow",
  component: TeammateRow,
  tags: ["autodocs"],
  args: {
    name: "CI Fixer",
    handle: "ci-fixer",
    tagline: "Keeps main green: reads failing checks and fixes them.",
    color: "orange",
    avatar: { kind: "symbol", symbol: "wrench" },
    enabled: true,
    dutyCount: 2,
    lastRunLabel: "2h ago",
    onToggleEnabled: () => undefined,
    actions: (
      <Button size="sm" variant="secondary">
        Talk
      </Button>
    ),
  },
};
export default meta;
type Story = StoryObj<typeof TeammateRow>;

export const Active: Story = {};

export const NewReport: Story = { args: { unread: true } };

export const PausedWithInitials: Story = {
  args: {
    name: "Release Notes Writer",
    handle: "release-notes",
    tagline: "",
    color: "teal",
    avatar: { kind: "initials" },
    enabled: false,
    dutyCount: 1,
    lastRunLabel: "Never",
  },
};

export const MonitorOnly: Story = {
  args: { enableDisabled: true, actions: undefined },
};
