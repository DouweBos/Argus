import { LANE_COLORS, type GraphRow } from "@argus/peacock";

export { LANE_COLORS, type GraphRow };

interface CommitLike {
  hash: string;
  parentHash: string;
}

/**
 * Build lane-based graph layout from an ordered list of commits.
 * Each commit gets a column assignment and connection info for rendering.
 *
 * After each commit, interior null lanes are removed and surviving lanes
 * shift left to keep the graph tightly packed against the left edge.
 * Columns that move are recorded in `shifts` so the renderer can draw a
 * diagonal connector for the lane's top half.
 */
export function buildGraphLanes(commits: CommitLike[]): GraphRow[] {
  const lanes: (string | null)[] = [];
  const colColors: (number | null)[] = [];
  const rows: GraphRow[] = [];
  const laneColors = new Map<string, number>();
  let nextColor = 0;

  for (const commit of commits) {
    const parents = commit.parentHash
      ? commit.parentHash.split(" ").filter(Boolean)
      : [];
    const isMerge = parents.length > 1;

    // Snapshot pre-mod (top-frame) lane colors for merge / shift coloring
    const laneColorTop = new Map<number, number>();
    for (let i = 0; i < colColors.length; i++) {
      if (colColors[i] !== null) {
        laneColorTop.set(i, colColors[i]! % LANE_COLORS.length);
      }
    }

    // Snapshot active lanes BEFORE modifications (top frame)
    const lanesToTop: number[] = [];
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] !== null) {
        lanesToTop.push(i);
      }
    }

    // Find which lane(s) this commit appears in
    const matchingLanes: number[] = [];
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === commit.hash) {
        matchingLanes.push(i);
      }
    }

    let column: number;
    if (matchingLanes.length > 0) {
      column = matchingLanes[0]!;
    } else {
      column = lanes.length;
      lanes.push(commit.hash);
      colColors.push(null);
      matchingLanes.push(column);
    }

    // Assign color. If the commit lands on an existing lane, prefer that
    // lane's current color so it stays consistent across all the rows it
    // lives on. Falling back to `laneColors[hash]` here would let a lane
    // suddenly switch palette at a merge-base whenever the hash had been
    // introduced earlier as a fork destination with a different color.
    let color: number;
    const existingLaneColor =
      matchingLanes.length > 0 ? colColors[matchingLanes[0]!] : null;
    if (existingLaneColor !== null && existingLaneColor !== undefined) {
      color = existingLaneColor;
      laneColors.set(commit.hash, color);
    } else if (laneColors.has(commit.hash)) {
      color = laneColors.get(commit.hash)!;
    } else {
      color = nextColor++;
      laneColors.set(commit.hash, color);
    }
    colColors[column] = color;
    if (!laneColorTop.has(column)) {
      laneColorTop.set(column, color % LANE_COLORS.length);
    }

    // Collect merges (extra matching lanes collapsing into the commit column)
    const merges: { color?: number; fromCol: number; toCol: number }[] = [];
    for (let i = matchingLanes.length - 1; i >= 1; i--) {
      const extraLane = matchingLanes[i]!;
      merges.push({
        fromCol: extraLane,
        toCol: column,
        color: laneColorTop.get(extraLane) ?? color % LANE_COLORS.length,
      });
      lanes[extraLane] = null;
      colColors[extraLane] = null;
    }

    // First parent continues in the same lane
    if (parents[0]) {
      lanes[column] = parents[0];
      if (!laneColors.has(parents[0])) {
        laneColors.set(parents[0], color);
      }
    } else {
      lanes[column] = null;
      colColors[column] = null;
    }

    // Additional parents: find or allocate lanes
    const forks: { color?: number; fromCol: number; toCol: number }[] = [];
    for (let p = 1; p < parents.length; p++) {
      const parentHash = parents[p]!;
      let parentLane = lanes.indexOf(parentHash);
      if (parentLane === -1) {
        const emptySlot = lanes.indexOf(null);
        if (emptySlot !== -1) {
          parentLane = emptySlot;
          lanes[emptySlot] = parentHash;
        } else {
          parentLane = lanes.length;
          lanes.push(parentHash);
        }

        if (!laneColors.has(parentHash)) {
          laneColors.set(parentHash, nextColor++);
        }

        colColors[parentLane] = laneColors.get(parentHash)!;
      }

      forks.push({
        fromCol: column,
        toCol: parentLane,
        color: laneColors.get(parentHash)! % LANE_COLORS.length,
      });
    }

    // Compact ALL null lanes (interior + trailing) to keep lanes left-aligned
    const colRemap = new Map<number, number>();
    let writeIdx = 0;
    for (let readIdx = 0; readIdx < lanes.length; readIdx++) {
      if (lanes[readIdx] !== null) {
        colRemap.set(readIdx, writeIdx);
        if (readIdx !== writeIdx) {
          lanes[writeIdx] = lanes[readIdx];
          colColors[writeIdx] = colColors[readIdx];
        }
        writeIdx++;
      }
    }
    lanes.length = writeIdx;
    colColors.length = writeIdx;

    // Remap commit column and forks (which use post-mod / pre-compact frame)
    const newColumn = colRemap.get(column) ?? column;
    for (const f of forks) {
      f.fromCol = colRemap.get(f.fromCol) ?? f.fromCol;
      f.toCol = colRemap.get(f.toCol) ?? f.toCol;
    }
    // Merge curves end at the commit node; update toCol to post-compact frame
    for (const m of merges) {
      m.toCol = newColumn;
    }

    // Compute shifts for surviving lanes that moved during compaction
    const mergedFromCols = new Set(merges.map((m) => m.fromCol));
    const shifts: { color: number; fromCol: number; toCol: number }[] = [];
    for (const oldCol of lanesToTop) {
      if (mergedFromCols.has(oldCol)) {
        continue;
      }
      const newCol = colRemap.get(oldCol);
      if (newCol === undefined) {
        continue;
      } // lane terminated (no parents)
      if (newCol !== oldCol) {
        shifts.push({
          fromCol: oldCol,
          toCol: newCol,
          color: laneColorTop.get(oldCol) ?? newCol % LANE_COLORS.length,
        });
      }
    }

    // Snapshot active lanes AFTER modifications (bottom frame)
    const lanesToBottom: number[] = [];
    const laneColorMap = new Map<number, number>();
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] !== null) {
        lanesToBottom.push(i);
        laneColorMap.set(i, colColors[i]! % LANE_COLORS.length);
      }
    }

    // Ensure laneColorMap has entries that the renderer may look up for the
    // top frame too (passing lanes / merge sources whose col index is not
    // reused below).
    for (const [topCol, topColor] of laneColorTop) {
      if (!laneColorMap.has(topCol)) {
        laneColorMap.set(topCol, topColor);
      }
    }

    const laneCount = Math.max(
      lanes.length,
      newColumn + 1,
      lanesToTop.length === 0 ? 0 : lanesToTop[lanesToTop.length - 1]! + 1,
    );

    rows.push({
      column: newColumn,
      laneCount,
      lanesToTop,
      lanesToBottom,
      merges,
      forks,
      shifts,
      isMerge,
      laneColorMap,
      color: color % LANE_COLORS.length,
    });
  }

  return rows;
}
