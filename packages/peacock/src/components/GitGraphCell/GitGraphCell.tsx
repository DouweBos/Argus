import type React from "react";
import styles from "./GitGraphCell.module.css";

export const LANE_COLORS = [
  "#e06c75",
  "#e5c07b",
  "#98c379",
  "#61afef",
  "#c678dd",
  "#56b6c2",
  "#d19a66",
  "#be5046",
];

export interface GraphRow {
  /** Color index for the commit node */
  color: number;
  column: number;
  /** New lanes forking out from the commit column (bottom frame) */
  forks: { fromCol: number; toCol: number; color?: number }[];
  isMerge: boolean;
  /** Color index for each lane column (column index → palette index) */
  laneColorMap: Map<number, number>;
  laneCount: number;
  /** Lane indices going down out of this row (post-shift / bottom frame) */
  lanesToBottom: number[];
  /** Lane indices coming in from above (pre-shift / top frame) */
  lanesToTop: number[];
  /** Extra lanes merging into the commit column (fromCol = top frame) */
  merges: { fromCol: number; toCol: number; color?: number }[];
  /**
   * Lanes that survived but shifted column during compaction. Drawn as a
   * diagonal from `fromCol` (top frame) at the row top to `toCol` (bottom
   * frame) at the row midpoint. The bottom half is drawn straight at `toCol`
   * via `lanesToBottom`.
   */
  shifts?: { fromCol: number; toCol: number; color: number }[];
}

const LANE_WIDTH = 12;
const NODE_RADIUS = 3.5;
/** Extend lines past row edges to cover the 1px border between rows */
const BLEED = 1;

export interface GitGraphCellProps {
  row: GraphRow;
  rowHeight: number;
}

/** Renders a single row of a git graph (lanes, merges, forks, commit node). */
export function GitGraphCell({ row, rowHeight }: GitGraphCellProps) {
  const width = Math.max(row.laneCount, row.column + 1) * LANE_WIDTH + 4;
  const midY = rowHeight / 2;

  function laneX(col: number): number {
    return col * LANE_WIDTH + LANE_WIDTH / 2 + 2;
  }

  function laneColor(col: number): string {
    const idx = row.laneColorMap.get(col) ?? col % LANE_COLORS.length;

    return LANE_COLORS[idx]!;
  }

  const shifts = row.shifts ?? [];
  const forkDestinations = new Set(row.forks.map((f) => f.toCol));
  const mergeOrigins = new Set(row.merges.map((m) => m.fromCol));
  const shiftFromCols = new Set(shifts.map((s) => s.fromCol));
  const elements: React.ReactNode[] = [];
  let key = 0;

  // Top halves: lanes coming in from the row above
  for (const col of row.lanesToTop) {
    if (mergeOrigins.has(col) || shiftFromCols.has(col)) {
      continue;
    }
    const x = laneX(col);
    elements.push(
      <line
        key={key++}
        stroke={laneColor(col)}
        strokeWidth={1.5}
        x1={x}
        x2={x}
        y1={-BLEED}
        y2={midY}
      />,
    );
  }

  // Bottom halves: lanes going down to the next row
  for (const col of row.lanesToBottom) {
    if (forkDestinations.has(col)) {
      continue;
    }
    const x = laneX(col);
    elements.push(
      <line
        key={key++}
        stroke={laneColor(col)}
        strokeWidth={1.5}
        x1={x}
        x2={x}
        y1={midY}
        y2={rowHeight + BLEED}
      />,
    );
  }

  // Merge curves: extra lanes converging into commit column (top → node)
  for (const m of row.merges) {
    const x1 = laneX(m.fromCol);
    const x2 = laneX(m.toCol);
    const switchStart = midY * 0.2;
    const switchEnd = midY * 0.8;
    const stroke =
      m.color !== undefined ? LANE_COLORS[m.color]! : laneColor(m.fromCol);
    elements.push(
      <path
        key={key++}
        d={`M${x1},${-BLEED} L${x1},${switchStart} C${x1},${switchEnd} ${x2},${switchStart} ${x2},${switchEnd} L${x2},${midY}`}
        fill="none"
        stroke={stroke}
        strokeLinejoin="round"
        strokeWidth={1.5}
      />,
    );
  }

  // Fork curves: commit column diverging to new parent lanes (node → bottom)
  for (const f of row.forks) {
    const x1 = laneX(f.fromCol);
    const x2 = laneX(f.toCol);
    const switchStart = midY + midY * 0.2;
    const switchEnd = midY + midY * 0.8;
    const stroke =
      f.color !== undefined ? LANE_COLORS[f.color]! : laneColor(f.toCol);
    elements.push(
      <path
        key={key++}
        d={`M${x1},${midY} L${x1},${switchStart} C${x1},${switchEnd} ${x2},${switchStart} ${x2},${switchEnd} L${x2},${rowHeight + BLEED}`}
        fill="none"
        stroke={stroke}
        strokeLinejoin="round"
        strokeWidth={1.5}
      />,
    );
  }

  // Shift curves: lanes that compact leftward (top half diagonal arriving at
  // the bottom-frame column at midY; bottom half drawn by lanesToBottom).
  for (const s of shifts) {
    const x1 = laneX(s.fromCol);
    const x2 = laneX(s.toCol);
    const switchStart = midY * 0.2;
    const switchEnd = midY * 0.8;
    elements.push(
      <path
        key={key++}
        d={`M${x1},${-BLEED} L${x1},${switchStart} C${x1},${switchEnd} ${x2},${switchStart} ${x2},${switchEnd} L${x2},${midY}`}
        fill="none"
        stroke={LANE_COLORS[s.color]!}
        strokeLinejoin="round"
        strokeWidth={1.5}
      />,
    );
  }

  const cx = laneX(row.column);
  const nodeColor = laneColor(row.column);

  return (
    <svg
      className={styles.graphCell}
      height={rowHeight}
      style={{ overflow: "visible" }}
      width={width}
    >
      {elements}
      {row.isMerge ? (
        <>
          <circle
            cx={cx}
            cy={midY}
            fill="none"
            r={NODE_RADIUS + 1}
            stroke={nodeColor}
            strokeWidth={1.5}
          />
          <circle cx={cx} cy={midY} fill={nodeColor} r={NODE_RADIUS - 1} />
        </>
      ) : (
        <circle cx={cx} cy={midY} fill={nodeColor} r={NODE_RADIUS} />
      )}
    </svg>
  );
}
