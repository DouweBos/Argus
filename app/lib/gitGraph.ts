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

interface CommitLike {
  hash: string;
  parentHash: string;
}

/**
 * Build lane-based graph layout from an ordered list of commits.
 * Each commit gets a column assignment and connection info for rendering.
 */
export function buildGraphLanes(commits: CommitLike[]): GraphRow[] {
  // Active lanes: each entry is the commit hash the lane is "waiting for"
  const lanes: (string | null)[] = [];
  // Color index assigned to each lane column
  const colColors: (number | null)[] = [];
  const rows: GraphRow[] = [];
  const laneColors = new Map<string, number>();
  let nextColor = 0;

  for (const commit of commits) {
    const parents = commit.parentHash
      ? commit.parentHash.split(" ").filter(Boolean)
      : [];
    const isMerge = parents.length > 1;

    // Find which lane(s) this commit appears in
    const matchingLanes: number[] = [];
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === commit.hash) {
        matchingLanes.push(i);
      }
    }

    // Snapshot active lanes BEFORE modifications (lanes connecting upward)
    const lanesToTop: number[] = [];
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] !== null) {
        lanesToTop.push(i);
      }
    }

    // Snapshot lane colors before modifications
    const laneColorMap = new Map<number, number>();
    for (let i = 0; i < colColors.length; i++) {
      if (colColors[i] !== null) {
        laneColorMap.set(i, colColors[i]! % LANE_COLORS.length);
      }
    }

    let column: number;
    if (matchingLanes.length > 0) {
      column = matchingLanes[0]!;
    } else {
      // New branch head — allocate a new lane
      column = lanes.length;
      lanes.push(commit.hash);
      matchingLanes.push(column);
    }

    // Assign color
    let color: number;
    if (laneColors.has(commit.hash)) {
      color = laneColors.get(commit.hash)!;
    } else {
      color = nextColor++;
      laneColors.set(commit.hash, color);
    }

    // Ensure this commit's lane has a color in the map
    if (!laneColorMap.has(column)) {
      laneColorMap.set(column, color % LANE_COLORS.length);
    }

    colColors[column] = color;

    // Collect merges (extra matching lanes collapsing into the commit column)
    const merges: { fromCol: number; toCol: number }[] = [];
    for (let i = matchingLanes.length - 1; i >= 1; i--) {
      const extraLane = matchingLanes[i]!;
      merges.push({ fromCol: extraLane, toCol: column });
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
    const forks: { fromCol: number; toCol: number }[] = [];
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

      forks.push({ fromCol: column, toCol: parentLane });
      // Add fork destination color to the map
      laneColorMap.set(
        parentLane,
        laneColors.get(parentHash)! % LANE_COLORS.length,
      );
    }

    // Compact trailing null lanes
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop();
      colColors.pop();
    }

    // Snapshot active lanes AFTER modifications (lanes connecting downward)
    const lanesToBottom: number[] = [];
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] !== null) {
        lanesToBottom.push(i);
        // Ensure bottom lanes are in the color map
        if (!laneColorMap.has(i) && colColors[i] !== null) {
          laneColorMap.set(i, colColors[i]! % LANE_COLORS.length);
        }
      }
    }

    rows.push({
      column,
      laneCount: Math.max(lanes.length, column + 1),
      lanesToTop,
      lanesToBottom,
      merges,
      forks,
      isMerge,
      laneColorMap,
      color: color % LANE_COLORS.length,
    });
  }

  return rows;
}

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
