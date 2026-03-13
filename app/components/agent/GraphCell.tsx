import type React from "react";
import type { GraphRow } from "../../lib/gitGraph";
import { LANE_COLORS } from "../../lib/gitGraph";
import styles from "./GraphCell.module.css";

const LANE_WIDTH = 12;
const NODE_RADIUS = 3.5;
/** Extend lines past row edges to cover the 1px border between rows */
const BLEED = 1;

interface GraphCellProps {
  row: GraphRow;
  rowHeight: number;
}

export function GraphCell({ row, rowHeight }: GraphCellProps) {
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

  // All lane indices that appear in either top or bottom
  const allLanes = new Set([...row.lanesToTop, ...row.lanesToBottom]);

  for (const col of allLanes) {
    const x = laneX(col);
    const color = laneColor(col);
    const inTop = topSet.has(col);
    const inBottom = bottomSet.has(col);

    // Skip lanes where a curve already covers the segment
    if (!inTop && forkDestinations.has(col)) continue;
    if (!inBottom && mergeOrigins.has(col)) continue;

    if (inTop && inBottom) {
      elements.push(
        <line
          key={key++}
          x1={x}
          y1={-BLEED}
          x2={x}
          y2={rowHeight + BLEED}
          stroke={color}
          strokeWidth={1.5}
        />,
      );
    } else if (inTop) {
      elements.push(
        <line
          key={key++}
          x1={x}
          y1={-BLEED}
          x2={x}
          y2={midY}
          stroke={color}
          strokeWidth={1.5}
        />,
      );
    } else {
      elements.push(
        <line
          key={key++}
          x1={x}
          y1={midY}
          x2={x}
          y2={rowHeight + BLEED}
          stroke={color}
          strokeWidth={1.5}
        />,
      );
    }
  }

  // Merge curves: extra lanes converging into commit column (top → node)
  // Shaped like a train track switch: vertical, diagonal, vertical
  for (const m of row.merges) {
    const x1 = laneX(m.fromCol);
    const x2 = laneX(m.toCol);
    const switchStart = midY * 0.25;
    const switchEnd = midY * 0.5;
    elements.push(
      <path
        key={key++}
        d={`M${x1},${-BLEED} L${x1},${switchStart} L${x2},${switchEnd} L${x2},${midY}`}
        stroke={laneColor(m.fromCol)}
        strokeWidth={1.5}
        fill="none"
        strokeLinejoin="round"
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
        stroke={laneColor(f.toCol)}
        strokeWidth={1.5}
        fill="none"
        strokeLinejoin="round"
      />,
    );
  }

  // Commit node — use the same color as the lane line
  const cx = laneX(row.column);
  const nodeColor = laneColor(row.column);

  return (
    <svg
      className={styles.graphCell}
      width={width}
      height={rowHeight}
      style={{ overflow: "visible" }}
    >
      {elements}
      {row.isMerge ? (
        <>
          <circle
            cx={cx}
            cy={midY}
            r={NODE_RADIUS + 1}
            fill="none"
            stroke={nodeColor}
            strokeWidth={1.5}
          />
          <circle cx={cx} cy={midY} r={NODE_RADIUS - 1} fill={nodeColor} />
        </>
      ) : (
        <circle cx={cx} cy={midY} r={NODE_RADIUS} fill={nodeColor} />
      )}
    </svg>
  );
}
