import type { Meta, StoryObj } from "@storybook/react";
import { ChatIcon } from "../../icons/Icons";
import { Button } from "../Button/Button";
import { AutomationRunView } from "./AutomationRunView";
import { RunReport } from "./RunReport";

const meta: Meta<typeof AutomationRunView> = {
  title: "Automations/AutomationRunView",
  component: AutomationRunView,
  tags: ["autodocs"],
  args: {
    title: "Oct 31, 09:00",
    reason: "schedule 09:00",
    duration: "2m 34s",
    cost: "$0.42",
    finished: "Oct 31, 09:02",
    session: "automation host",
  },
};
export default meta;
type Story = StoryObj<typeof AutomationRunView>;

const ACTIONS = (
  <>
    <Button leading={<ChatIcon size={11} />} size="sm" variant="secondary">
      Give feedback
    </Button>
    <Button size="sm" variant="ghost">
      Delete
    </Button>
  </>
);

export const Succeeded: Story = {
  args: {
    status: "succeeded",
    actions: ACTIONS,
    report: (
      <RunReport
        active={false}
        blocks={[
          { type: "heading", text: "Two issues worth starting today" },
          { type: "markdown", text: "Both are small and **well specified**." },
        ]}
        markdown={null}
      />
    ),
    feedback: [
      {
        id: "f1",
        note: "The flaky test is not a nice-to-have.",
        allow_clearing: true,
        created_at: Date.now() - 3_600_000,
      },
    ],
  },
};

export const Running: Story = {
  args: {
    status: "running",
    live: true,
    finished: "—",
    report: <RunReport active blocks={null} markdown={null} />,
  },
};

export const Failed: Story = {
  args: {
    status: "failed",
    error: "gh: not authenticated. Run `gh auth login` on the computer.",
    report: <RunReport active={false} blocks={null} markdown={null} />,
  },
};

export const MarkdownReport: Story = {
  args: {
    status: "succeeded",
    report: (
      <RunReport
        active={false}
        blocks={null}
        markdown={"## Weekly\n\n- Shipped the inbox\n- Fixed two crashes"}
      />
    ),
  },
};
