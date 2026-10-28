import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { IssueCard } from "../IssueCard/IssueCard";
import { IssueStatusIcon } from "../IssueStatusIcon/IssueStatusIcon";
import { PriorityIcon } from "../PriorityIcon/PriorityIcon";
import { IssueBoard } from "./IssueBoard";

const meta: Meta<typeof IssueBoard> = {
  title: "Components/IssueBoard",
  component: IssueBoard,
  parameters: { layout: "padded" },
};

export default meta;

type Story = StoryObj<typeof IssueBoard>;

const COLUMNS = [
  {
    id: "todo",
    title: "Todo",
    count: 1,
    icon: <IssueStatusIcon type="unstarted" />,
  },
  {
    id: "doing",
    title: "In Progress",
    count: 1,
    icon: <IssueStatusIcon type="started" />,
  },
  {
    id: "review",
    title: "In Review",
    count: 1,
    icon: <IssueStatusIcon type="started" />,
  },
];

const CARDS: Record<
  string,
  Record<string, { id: string; title: string; type: string; p: number }[]>
> = {
  high: {
    todo: [
      {
        id: "STR-3183",
        title: "Identity link for vizio and amazon fire tv",
        type: "unstarted",
        p: 2,
      },
    ],
    doing: [
      {
        id: "STR-4294",
        title: "Kochava SDK Updates (Android + iOS)",
        type: "started",
        p: 2,
      },
    ],
  },
  none: {
    review: [
      {
        id: "RNG-872",
        title: "Release RN through the legacy Tizen and webOS loaders",
        type: "started",
        p: 0,
      },
    ],
  },
};

export const Swimlanes: Story = {
  render: () => {
    const [collapsed, setCollapsed] = useState<string[]>([]);
    const lanes = [
      {
        id: "high",
        title: "High",
        count: 2,
        icon: <PriorityIcon priority={2} />,
      },
      {
        id: "none",
        title: "No priority",
        count: 1,
        icon: <PriorityIcon priority={0} />,
      },
    ].map((l) => ({ ...l, collapsed: collapsed.includes(l.id) }));

    return (
      <IssueBoard
        columns={COLUMNS}
        lanes={lanes}
        onToggleLane={(id) =>
          setCollapsed((c) =>
            c.includes(id) ? c.filter((x) => x !== id) : [...c, id],
          )
        }
        renderCell={(lane, column) =>
          (CARDS[lane]?.[column] ?? []).map((c) => (
            <IssueCard
              key={c.id}
              identifier={c.id}
              title={c.title}
              statusType={c.type}
              priority={c.p}
            />
          ))
        }
      />
    );
  },
};

export const NoLanes: Story = {
  render: () => (
    <IssueBoard
      columns={COLUMNS}
      renderCell={(_lane, column) =>
        Object.values(CARDS)
          .flatMap((lane) => lane[column] ?? [])
          .map((c) => (
            <IssueCard
              key={c.id}
              identifier={c.id}
              title={c.title}
              statusType={c.type}
              priority={c.p}
            />
          ))
      }
    />
  ),
};
