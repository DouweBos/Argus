import { useState } from "react";
import { IssueBoard } from "../IssueBoard/IssueBoard";
import { IssueCard, type IssueCardProps } from "../IssueCard/IssueCard";
import { IssueStatusIcon } from "../IssueStatusIcon/IssueStatusIcon";
import { PRIORITY_LABELS, PriorityIcon } from "../PriorityIcon/PriorityIcon";

/** A card's content; `identifier` is what `onOpen` and `selected` speak. */
export type IssueCardItem = Omit<IssueCardProps, "onClick" | "selected">;

/** A workflow state's column. */
export interface IssueBoardViewColumn {
  color: string | null;
  count: number;
  id: string;
  name: string;
  type: string;
}

export interface IssueBoardViewProps {
  /** Cards for one priority in one column, in the order they show. */
  cards: (priority: number, columnId: string) => IssueCardItem[];
  columns: IssueBoardViewColumn[];
  hiddenColumns?: IssueBoardViewColumn[];
  /** Priorities with cards on the board, most urgent first. */
  lanes: { count: number; priority: number }[];
  onHideColumn?: (columnId: string) => void;
  onOpen: (identifier: string) => void;
  onShowColumn?: (columnId: string) => void;
  selected: string | null;
}

/** A column per status, a swimlane per priority; empty lanes are left out. */
export function IssueBoardView({
  cards,
  columns,
  hiddenColumns = [],
  lanes,
  onHideColumn,
  onOpen,
  onShowColumn,
  selected,
}: IssueBoardViewProps) {
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const toBoardColumn = (c: IssueBoardViewColumn) => ({
    id: c.id,
    title: c.name,
    count: c.count,
    icon: <IssueStatusIcon color={c.color} type={c.type} />,
  });

  return (
    <IssueBoard
      columns={columns.map(toBoardColumn)}
      hiddenColumns={hiddenColumns.map(toBoardColumn)}
      onHideColumn={onHideColumn}
      onShowColumn={onShowColumn}
      lanes={lanes.map((lane) => ({
        id: String(lane.priority),
        title: PRIORITY_LABELS[lane.priority] ?? PRIORITY_LABELS[0],
        icon: <PriorityIcon priority={lane.priority} />,
        count: lane.count,
        collapsed: collapsed.includes(String(lane.priority)),
      }))}
      onToggleLane={(id) =>
        setCollapsed((current) =>
          current.includes(id)
            ? current.filter((x) => x !== id)
            : [...current, id],
        )
      }
      renderCell={(laneId, columnId) =>
        cards(Number(laneId), columnId).map((card) => (
          <IssueCard
            key={card.identifier}
            {...card}
            selected={card.identifier === selected}
            onClick={() => onOpen(card.identifier)}
          />
        ))
      }
    />
  );
}
