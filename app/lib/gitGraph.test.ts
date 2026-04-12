import { describe, expect, it } from "vitest";
import { LANE_COLORS, buildGraphLanes } from "./gitGraph";

function commits(
  ...specs: { hash: string; parents?: string }[]
): { hash: string; parentHash: string }[] {
  return specs.map((s) => ({
    hash: s.hash,
    parentHash: s.parents ?? "",
  }));
}

describe("buildGraphLanes", () => {
  it("returns empty array for empty input", () => {
    expect(buildGraphLanes([])).toEqual([]);
  });

  it("handles a single commit with no parents", () => {
    const rows = buildGraphLanes(commits({ hash: "a" }));
    expect(rows).toHaveLength(1);
    expect(rows[0].column).toBe(0);
    expect(rows[0].isMerge).toBe(false);
    expect(rows[0].forks).toEqual([]);
    expect(rows[0].merges).toEqual([]);
  });

  it("builds a linear history in column 0", () => {
    const rows = buildGraphLanes(
      commits(
        { hash: "c", parents: "b" },
        { hash: "b", parents: "a" },
        { hash: "a" },
      ),
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.column).toBe(0);
      expect(row.isMerge).toBe(false);
    }
  });

  it("detects merge commits", () => {
    const rows = buildGraphLanes(
      commits(
        { hash: "m", parents: "a b" },
        { hash: "a", parents: "root" },
        { hash: "b", parents: "root" },
        { hash: "root" },
      ),
    );
    expect(rows[0].isMerge).toBe(true);
    expect(rows[0].forks.length).toBeGreaterThan(0);
  });

  it("assigns colors within the palette range", () => {
    const rows = buildGraphLanes(
      commits(
        { hash: "c", parents: "b" },
        { hash: "b", parents: "a" },
        { hash: "a" },
      ),
    );
    for (const row of rows) {
      expect(row.color).toBeGreaterThanOrEqual(0);
      expect(row.color).toBeLessThan(LANE_COLORS.length);
    }
  });

  it("allocates separate lanes for parallel branches", () => {
    // Two branches diverging from root:
    // c1 -> root (on lane 0)
    // c2 -> root (on lane 1)
    const rows = buildGraphLanes(
      commits(
        { hash: "c1", parents: "root" },
        { hash: "c2", parents: "root" },
        { hash: "root" },
      ),
    );
    // c1 and c2 should be on different columns
    // (c1 takes lane 0, c2 gets a new lane since it's not expected by any lane)
    expect(rows[0].column).toBe(0);
    expect(rows[1].column).toBe(1);
  });

  it("provides laneCount >= column + 1", () => {
    const rows = buildGraphLanes(
      commits(
        { hash: "m", parents: "a b" },
        { hash: "a", parents: "root" },
        { hash: "b", parents: "root" },
        { hash: "root" },
      ),
    );
    for (const row of rows) {
      expect(row.laneCount).toBeGreaterThanOrEqual(row.column + 1);
    }
  });
});
