import type { LinearIssue } from "../../../lib/types";
import { GridScreen, IssueCard } from "@argus/peacock";
import { boardColumns, byPriority } from "../../../lib/issueBoard";
import styles from "./IssuesScreen.module.css";
import { useIssueCardProps } from "./useIssueCardProps";

interface IssuesListViewProps {
  issues: LinearIssue[];
  onOpen: (issue: LinearIssue) => void;
  selected: string | null;
}

/** Sections per status, most urgent first within each. */
export function IssuesListView({
  issues,
  onOpen,
  selected,
}: IssuesListViewProps) {
  const cardProps = useIssueCardProps();

  return (
    <>
      {boardColumns(issues).map((column) => (
        <GridScreen.Section
          key={column.id}
          title={column.name}
          count={column.issues.length}
        >
          <div className={styles.grid}>
            {[...column.issues].sort(byPriority).map((issue) => (
              <IssueCard
                key={issue.id}
                {...cardProps(issue)}
                selected={issue.identifier === selected}
                onClick={() => onOpen(issue)}
              />
            ))}
          </div>
        </GridScreen.Section>
      ))}
    </>
  );
}
