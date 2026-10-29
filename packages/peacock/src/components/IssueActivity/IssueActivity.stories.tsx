import type { Meta, StoryObj } from "@storybook/react";
import { IssueStatusIcon } from "../IssueStatusIcon/IssueStatusIcon";
import { PriorityIcon } from "../PriorityIcon/PriorityIcon";
import { type ActivityItem, IssueActivity } from "./IssueActivity";

const meta: Meta<typeof IssueActivity> = {
  title: "Components/IssueActivity",
  component: IssueActivity,
  decorators: [(Story) => <div style={{ maxWidth: 720 }}>{Story()}</div>],
};

export default meta;

type Story = StoryObj<typeof IssueActivity>;

const ITEMS: ActivityItem[] = [
  {
    kind: "event",
    id: "e1",
    icon: <IssueStatusIcon type="unstarted" />,
    actor: "emmanuel.barrera",
    text: "created the issue",
    time: "5w ago",
  },
  {
    kind: "event",
    id: "e2",
    icon: <PriorityIcon priority={2} />,
    actor: "jillian.broek",
    text: "set priority to High",
    time: "5w ago",
  },
  {
    kind: "event",
    id: "e3",
    icon: null,
    actor: "ashley.brewster",
    text: "changed the title to Kochava SDK Updates",
    time: "5w ago",
  },
  {
    kind: "event",
    id: "e4",
    icon: <IssueStatusIcon type="started" />,
    actor: "douwe",
    text: "changed status from Todo to In Progress",
    time: "4w ago",
  },
  {
    kind: "event",
    id: "e5",
    icon: null,
    actor: "Linear",
    text: "moved the issue from Cycle 57 to Cycle 59",
    time: "10d ago",
  },
  {
    kind: "thread",
    id: "t1",
    comments: [
      {
        id: "c1",
        author: "jillian.broek",
        time: "9mo ago",
        body: "Did y'all talk to Dickey about this ticket?",
      },
      {
        id: "c2",
        author: "dickey",
        time: "9mo ago",
        body: "Happy to give it a shot.",
        reactions: [{ emoji: "🙏", count: 1 }],
      },
    ],
    footer: (
      <span style={{ color: "var(--text-muted)", fontSize: 13 }}>
        Leave a reply…
      </span>
    ),
  },
];

export const Timeline: Story = { args: { items: ITEMS } };

export const ShortRun: Story = { args: { items: ITEMS.slice(0, 2) } };
