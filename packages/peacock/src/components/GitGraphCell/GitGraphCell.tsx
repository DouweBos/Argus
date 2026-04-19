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
  /** New lanes forking out from the commit column */
  forks: { fromCol: number; toCol: number }[];
  isMerge: boolean;
  /** Color index for each lane column (column index → palette index) */
  laneColorMap: Map<number, number>;
  laneCount: number;
  /** Lane indices with lines going down (active after this commit) */
  lanesToBottom: number[];
  /** Lane indices with lines going up (active before this commit) */
  lanesToTop: number[];
  /** Extra lanes merging into the commit column */
  merges: { fromCol: number; toCol: number }[];
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

  const topSet = new Set(row.lanesToTop);
  const bottomSet = new Set(row.lanesToBottom);
  const forkDestinations = new Set(row.forks.map((f) => f.toCol));
  const mergeOrigins = new Set(row.merges.map((m) => m.fromCol));
  const elements: React.ReactNode[] = [];
  let key = 0;

  const allLanes = new Set([...row.lanesToTop, ...row.lanesToBottom]);

  for (const col of allLanes) {
    const x = laneX(col);
    const color = laneColor(col);
    const inTop = topSet.has(col);
    const inBottom = bottomSet.has(col);

    if (!inTop && forkDestinations.has(col)) {
      continue;
    }
    if (!inBottom && mergeOrigins.has(col)) {
      continue;
    }

    if (inTop && inBottom) {
      elements.push(
        <line
          key={key++}
          stroke={color}
          strokeWidth={1.5}
          x1={x}
          x2={x}
          y1={-BLEED}
          y2={rowHeight + BLEED}
        />,
      );
    } else if (inTop) {
      elements.push(
        <line
          key={key++}
          stroke={color}
          strokeWidth={1.5}
          x1={x}
          x2={x}
          y1={-BLEED}
          y2={midY}
        />,
      );
    } else {
      elements.push(
        <line
          key={key++}
          stroke={color}
          strokeWidth={1.5}
          x1={x}
          x2={x}
          y1={midY}
          y2={rowHeight + BLEED}
        />,
      );
    }
  }

  // Merge curves: extra lanes converging into commit column (top → node)
  for (const m of row.merges) {
    const x1 = laneX(m.fromCol);
    const x2 = laneX(m.toCol);
    const switchStart = midY * 0.25;
    const switchEnd = midY * 0.5;
    elements.push(
      <path
        key={key++}
        d={`M${x1},${-BLEED} L${x1},${switchStart} L${x2},${switchEnd} L${x2},${midY}`}
        fill="none"
        stroke={laneColor(m.fromCol)}
        strokeLinejoin="round"
        strokeWidth={1.5}
      />,
    );
  }

  // Fork curves: commit column diverging to new parent lanes (node → bottom)
  for (const f of row.forks) {
    const x1 = laneX(f.fromCol);
    const x2 = laneX(f.toCol);
    const switchStart = midY + midY * 0.25;
    const switchEnd = midY + midY * 0.5;
    elements.push(
      <path
        key={key++}
        d={`M${x1},${midY} L${x1},${switchStart} L${x2},${switchEnd} L${x2},${rowHeight + BLEED}`}
        fill="none"
        stroke={laneColor(f.toCol)}
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
