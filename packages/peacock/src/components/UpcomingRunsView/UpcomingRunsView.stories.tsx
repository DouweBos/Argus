import type { Meta, StoryObj } from "@storybook/react";
import { UpcomingRunsView } from "./UpcomingRunsView";

const noop = () => undefined;

const meta: Meta<typeof UpcomingRunsView> = {
  title: "Automations/UpcomingRunsView",
  component: UpcomingRunsView,
  tags: ["autodocs"],
  args: { rows: [], onRetry: noop },
};
export default meta;
type Story = StoryObj<typeof UpcomingRunsView>;

export const Scheduled: Story = {
  args: {
    phase: { kind: "content" },
    rows: [
      {
        id: "a1",
        name: "PR shepherd",
        subtitle: "CI Fixer's duty",
        when: "in 12m · at 14:30",
        duty: true,
        onOpen: noop,
      },
      {
        id: "a2",
        name: "Morning triage",
        subtitle: "Automation",
        when: "in 2h · at 16:00",
        wait: {
          label: "Waits for the usage limit to reset at 15:40",
          tone: "warning",
        },
        onOpen: noop,
      },
      {
        id: "a3",
        name: "Fix my red CI",
        subtitle: "CI Fixer's duty",
        when: "in 3h · at 17:00",
        duty: true,
        wait: {
          label: "Waits for your approval on the run still going",
          tone: "warning",
        },
        onOpen: noop,
      },
      {
        id: "a4",
        name: "Release notes",
        subtitle: "Once · Automation",
        when: "in 2d · Fri at 09:00",
        wait: { label: "Paused", tone: "muted" },
        onOpen: noop,
      },
    ],
  },
};

export const Empty: Story = { args: { phase: { kind: "empty" } } };

export const Loading: Story = { args: { phase: { kind: "loading" } } };

export const Failed: Story = {
  args: { phase: { kind: "failed", error: "The computer didn't answer." } },
};
