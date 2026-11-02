import type { LinearIssue } from "../../../lib/types";
import { useEffect } from "react";
import {
  boardCell,
  boardColumns,
  boardLanes,
  byPriority,
  isColumnHidden,
} from "@argus/client-core";
import { IssueBoardView, IssueListView } from "@argus/peacock";
import {
  loadTeamStates,
  setColumnHidden,
  useColumnOverrides,
  useStatesByTeam,
} from "../../../stores/linearIssuesStore";
import { useIssueCardProps } from "./useIssueCardProps";

interface IssuesLayoutProps {
  issues: LinearIssue[];
  onOpen: (identifier: string) => void;
  selected: string | null;
}

/** The board, with every status of the teams involved so empty ones can be shown too. */
export function IssuesBoard({ issues, onOpen, selected }: IssuesLayoutProps) {
  const cardProps = useIssueCardProps();
  const overrides = useColumnOverrides();
  const statesByTeam = useStatesByTeam();
  const teamIds = [...new Set(issues.map((i) => i.teamId))];
  const teamKey = teamIds.sort().join(",");
  const all = boardColumns(
    issues,
    teamIds.flatMap((id) => statesByTeam[id] ?? []),
  );

  useEffect(() => {
    for (const id of teamKey.split(",").filter(Boolean)) {
      loadTeamStates(id).catch(() => {});
    }
  }, [teamKey]);
  const columns = all.filter((c) => !isColumnHidden(c, overrides));
  const view = (c: (typeof all)[number]) => ({ ...c, count: c.issues.length });

  return (
    <IssueBoardView
      cards={(priority, columnId) => {
        const column = columns.find((c) => c.id === columnId);

        return column ? boardCell(column, priority).map(cardProps) : [];
      }}
      columns={columns.map(view)}
      hiddenColumns={all.filter((c) => isColumnHidden(c, overrides)).map(view)}
      // Lanes count only what's on the board, so a lane of hidden issues disappears.
      lanes={boardLanes(columns.flatMap((c) => c.issues))}
      selected={selected}
      onHideColumn={(id) => setColumnHidden(id, true)}
      onOpen={onOpen}
      onShowColumn={(id) => setColumnHidden(id, false)}
    />
  );
}

/** Sections per status, most urgent first within each. */
export function IssuesList({ issues, onOpen, selected }: IssuesLayoutProps) {
  const cardProps = useIssueCardProps();

  return (
    <IssueListView
      sections={boardColumns(issues).map((column) => ({
        id: column.id,
        name: column.name,
        cards: [...column.issues].sort(byPriority).map(cardProps),
      }))}
      selected={selected}
      onOpen={onOpen}
    />
  );
}
