import type { CSSProperties, ReactNode } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "../../icons/Icons";
import styles from "./IssueBoard.module.css";

export interface IssueBoardColumn {
  count: number;
  icon?: ReactNode;
  id: string;
  title: string;
}

export interface IssueBoardLane {
  collapsed?: boolean;
  count: number;
  icon?: ReactNode;
  id: string;
  title: string;
}

export interface IssueBoardProps {
  columns: IssueBoardColumn[];
  /** Omit for a board without swimlanes: one implicit lane. */
  lanes?: IssueBoardLane[];
  onToggleLane?: (laneId: string) => void;
  /** Cards for one cell; `laneId` is "" without lanes. */
  renderCell: (laneId: string, columnId: string) => ReactNode;
}

/** Columns per status, optional swimlanes per group, cards in the cells. */
export function IssueBoard({
  columns,
  lanes,
  onToggleLane,
  renderCell,
}: IssueBoardProps) {
  // The column count is data; the track sizing stays in CSS.
  const columnCount = {
    "--issue-board-columns": columns.length,
  } as CSSProperties;

  return (
    <div className={styles.scroller}>
      <div className={styles.board} style={columnCount}>
        {columns.map((column) => (
          <div key={column.id} className={styles.columnHead}>
            {column.icon}
            <span className={styles.columnTitle}>{column.title}</span>
            <span className={styles.count}>{column.count}</span>
          </div>
        ))}
        {(lanes ?? [{ id: "", title: "", count: 0 }]).map((lane) => (
          <div key={lane.id || "all"} className={styles.lane}>
            {lanes && (
              <button
                className={styles.laneHead}
                type="button"
                onClick={() => onToggleLane?.(lane.id)}
              >
                {lane.collapsed ? (
                  <ChevronRightIcon size={10} />
                ) : (
                  <ChevronDownIcon size={10} />
                )}
                {lane.icon}
                <span>{lane.title}</span>
                <span className={styles.count}>{lane.count}</span>
              </button>
            )}
            {!lane.collapsed &&
              columns.map((column) => (
                <div key={column.id} className={styles.cell}>
                  {renderCell(lane.id, column.id)}
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
