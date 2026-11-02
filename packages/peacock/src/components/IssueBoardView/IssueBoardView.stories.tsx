import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { type IssueCardItem, IssueBoardView } from "./IssueBoardView";
import { IssueListView } from "./IssueListView";

const meta: Meta<typeof IssueBoardView> = {
  title: "Screens/IssueBoardView",
  component: IssueBoardView,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "The Issues screen's board (a column per status, a swimlane per priority) and list. Columns, lanes and cards come from `boardColumns`, `boardLanes`, `boardCell` and `issueCardData` in `@argus/client-core`.",
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof IssueBoardView>;

function card(
  identifier: string,
  title: string,
  priority: number,
  statusType: string,
  extra: Partial<IssueCardItem> = {},
): IssueCardItem & { column: string } {
  return {
    identifier,
    title,
    priority,
    statusType,
    footnote: "Created Oct 2026",
    column: statusType === "started" ? "in progress" : "todo",
    ...extra,
  };
}

const CARDS = [
  card("ENG-12", "Sign-in loops on expired tokens", 1, "unstarted", {
    labels: [{ name: "Bug", color: "#eb5757" }],
    assignee: { name: "Douwe Bos" },
  }),
  card("ENG-18", "Board columns follow the workflow", 2, "started", {
    badge: "Agent on it",
    pullRequestCount: 1,
    estimate: "M",
  }),
  card("ENG-21", "Copy branch name from the issue page", 3, "unstarted", {
    cycle: "59",
    project: "Issues",
  }),
  card("ENG-30", "Archive old automations", 0, "started"),
];

const COLUMNS = [
  { id: "todo", name: "Todo", type: "unstarted", color: null, count: 2 },
  {
    id: "in progress",
    name: "In Progress",
    type: "started",
    color: null,
    count: 2,
  },
];

const LANES = [1, 2, 3, 0].map((priority) => ({
  priority,
  count: CARDS.filter((c) => c.priority === priority).length,
}));

function Board({ withHidden }: { withHidden: boolean }) {
  const [selected, setSelected] = useState<string | null>("ENG-18");

  return (
    <IssueBoardView
      cards={(priority, columnId) =>
        CARDS.filter((c) => c.priority === priority && c.column === columnId)
      }
      columns={COLUMNS}
      hiddenColumns={
        withHidden
          ? [
              {
                id: "done",
                name: "Done",
                type: "completed",
                color: null,
                count: 7,
              },
            ]
          : []
      }
      lanes={LANES}
      selected={selected}
      onHideColumn={() => {}}
      onOpen={setSelected}
      onShowColumn={() => {}}
    />
  );
}

export const Default: Story = { render: () => <Board withHidden={false} /> };

export const WithHiddenColumns: Story = {
  render: () => <Board withHidden />,
};

export const List: Story = {
  render: () => (
    <IssueListView
      sections={COLUMNS.map((c) => ({
        id: c.id,
        name: c.name,
        cards: CARDS.filter((item) => item.column === c.id),
      }))}
      selected="ENG-12"
      onOpen={() => {}}
    />
  ),
};
