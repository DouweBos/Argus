import type { Meta, StoryObj } from "@storybook/react";
import { Badge } from "../Badge/Badge";
import { Button } from "../Button/Button";
import { RunHistoryRow } from "./RunHistoryRow";

const meta: Meta<typeof RunHistoryRow> = {
  title: "Primitives/RunHistoryRow",
  component: RunHistoryRow,
  tags: ["autodocs"],
  args: {
    startedAt: "17 Sep, 09:00",
    triggerReason: "schedule 09:00",
    duration: "1m 12s",
    cost: "$0.42",
    status: <Badge tone="success">succeeded</Badge>,
  },
};
export default meta;
type Story = StoryObj<typeof RunHistoryRow>;

export const Succeeded: Story = {};

export const Running: Story = {
  args: {
    status: <Badge tone="accent">running</Badge>,
    triggerReason: "manual",
    duration: "22s",
    cost: "—",
    actions: (
      <Button size="sm" variant="danger">
        Cancel
      </Button>
    ),
  },
};

export const Failed: Story = {
  args: {
    status: <Badge tone="error">failed</Badge>,
    error: "The run's agent exited with an error.",
  },
};

export const Skipped: Story = {
  args: {
    status: <Badge tone="warning">skipped</Badge>,
    error: "The previous run is still in progress.",
    duration: "0s",
    cost: "—",
  },
};

export const Selected: Story = { args: { selected: true } };

/** Across automations — the home screen's list, where the row needs naming. */
export const Named: Story = { args: { name: "Morning triage" } };

/** On a page rather than in a panel, the row carries its own surface. */
export const Card: Story = {
  args: {
    variant: "card",
    name: "Standup digest",
    status: <Badge tone="error">failed</Badge>,
    error: "Timeout waiting for agent b6cedde8 after 1200000ms.",
  },
};

/** A report nobody has read. Home leans on this to draw the eye. */
export const Unread: Story = {
  args: { unread: true, variant: "card", name: "Morning triage" },
};
