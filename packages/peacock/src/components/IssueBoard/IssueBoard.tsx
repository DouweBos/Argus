import type { CSSProperties, ReactNode } from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  MinusIcon,
} from "../../icons/Icons";
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
  /** Listed beside the board with their counts; clicking one shows it. */
  hiddenColumns?: IssueBoardColumn[];
  /** Omit for a board without swimlanes: one implicit lane. */
  lanes?: IssueBoardLane[];
  /** Shows a hide button on each column header. */
  onHideColumn?: (columnId: string) => void;
  onShowColumn?: (columnId: string) => void;
  onToggleLane?: (laneId: string) => void;
  /** Cards for one cell; `laneId` is "" without lanes. */
  renderCell: (laneId: string, columnId: string) => ReactNode;
}

/** Columns per status, optional swimlanes per group, cards in the cells. */
export function IssueBoard({
  columns,
  hiddenColumns = [],
  lanes,
  onHideColumn,
  onShowColumn,
  onToggleLane,
  renderCell,
}: IssueBoardProps) {
  // The column count is data; the track sizing stays in CSS.
  const columnCount = {
    "--issue-board-columns": Math.max(columns.length, 1),
  } as CSSProperties;

  return (
    <div className={styles.root}>
      <div className={styles.scroller}>
        <div className={styles.board} style={columnCount}>
          {columns.map((column) => (
            <div key={column.id} className={styles.columnHead}>
              {column.icon}
              <span className={styles.columnTitle}>{column.title}</span>
              <span className={styles.count}>{column.count}</span>
              {onHideColumn && (
                <button
                  aria-label={`Hide ${column.title}`}
                  className={styles.hide}
                  title="Hide column"
                  type="button"
                  onClick={() => onHideColumn(column.id)}
                >
                  <MinusIcon size={10} />
                </button>
              )}
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
      {hiddenColumns.length > 0 && (
        <aside className={styles.hidden} aria-label="Hidden columns">
          <div className={styles.hiddenTitle}>Hidden columns</div>
          {hiddenColumns.map((column) => (
            <button
              key={column.id}
              className={styles.hiddenRow}
              title={`Show ${column.title}`}
              type="button"
              onClick={() => onShowColumn?.(column.id)}
            >
              {column.icon}
              <span className={styles.columnTitle}>{column.title}</span>
              <span className={styles.count}>{column.count}</span>
            </button>
          ))}
        </aside>
      )}
    </div>
  );
}
