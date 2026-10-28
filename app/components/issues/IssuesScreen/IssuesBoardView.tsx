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
  PRIORITY_ORDER,
} from "../../../lib/issueBoard";
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
  const columns = boardColumns(issues);
  const lanes = PRIORITY_ORDER.map((priority) => ({
    id: String(priority),
    title: PRIORITY_LABELS[priority],
    icon: <PriorityIcon priority={priority} />,
    count: issues.filter((i) => i.priority === priority).length,
    collapsed: collapsed.includes(String(priority)),
  })).filter((lane) => lane.count > 0);

  return (
    <IssueBoard
      columns={columns.map((c) => ({
        id: c.id,
        title: c.name,
        count: c.issues.length,
        icon: <IssueStatusIcon type={c.type} />,
      }))}
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
