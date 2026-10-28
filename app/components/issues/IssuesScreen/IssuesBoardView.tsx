import type { LinearIssue } from "../../../lib/types";
import { useState } from "react";
import {
  IssueBoard,
  IssueCard,
  IssueStatusIcon,
  PRIORITY_LABELS,
  PriorityIcon,
} from "@argus/peacock";
import {
  boardColumns,
  byPriority,
  isColumnHidden,
  PRIORITY_ORDER,
} from "../../../lib/issueBoard";
import {
  setColumnHidden,
  useColumnOverrides,
} from "../../../stores/linearIssuesStore";
import { useIssueCardProps } from "./useIssueCardProps";

interface IssuesBoardViewProps {
  issues: LinearIssue[];
  onOpen: (issue: LinearIssue) => void;
  selected: string | null;
}

/** A column per status, a swimlane per priority; empty lanes are left out. */
export function IssuesBoardView({
  issues,
  onOpen,
  selected,
}: IssuesBoardViewProps) {
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const cardProps = useIssueCardProps();
  const overrides = useColumnOverrides();
  const all = boardColumns(issues);
  const columns = all.filter((c) => !isColumnHidden(c, overrides));
  const shown = columns.flatMap((c) => c.issues);
  const toBoardColumn = (c: (typeof all)[number]) => ({
    id: c.id,
    title: c.name,
    count: c.issues.length,
    icon: <IssueStatusIcon type={c.type} />,
  });
  // Lanes count only what's on the board, so a lane of hidden issues disappears.
  const lanes = PRIORITY_ORDER.map((priority) => ({
    id: String(priority),
    title: PRIORITY_LABELS[priority],
    icon: <PriorityIcon priority={priority} />,
    count: shown.filter((i) => i.priority === priority).length,
    collapsed: collapsed.includes(String(priority)),
  })).filter((lane) => lane.count > 0);

  return (
    <IssueBoard
      columns={columns.map(toBoardColumn)}
      hiddenColumns={all
        .filter((c) => isColumnHidden(c, overrides))
        .map(toBoardColumn)}
      onHideColumn={(id) => setColumnHidden(id, true)}
      onShowColumn={(id) => setColumnHidden(id, false)}
      lanes={lanes}
      onToggleLane={(id) =>
        setCollapsed((current) =>
          current.includes(id)
            ? current.filter((x) => x !== id)
            : [...current, id],
        )
      }
      renderCell={(laneId, columnId) =>
        (columns.find((c) => c.id === columnId)?.issues ?? [])
          .filter((issue) => String(issue.priority) === laneId)
          .sort(byPriority)
          .map((issue) => (
            <IssueCard
              key={issue.id}
              {...cardProps(issue)}
              selected={issue.identifier === selected}
              onClick={() => onOpen(issue)}
            />
          ))
      }
    />
  );
}
