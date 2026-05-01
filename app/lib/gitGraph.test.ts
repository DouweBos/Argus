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

  it("compacts surviving lanes leftward after a branch dies", () => {
    // Three branches share a root. After the branch on lane 1 merges into
    // lane 0, the long-running branch originally on lane 2 should shift left
    // to lane 1 to avoid leaving an empty gap.
    //
    //   m  parents: a c   (merge of feature into main)
    //   a  parents: root  (main, lane 0)
    //   c  parents: c1    (long-running branch)
    //   c1 parents: root
    //   root
    const rows = buildGraphLanes(
      commits(
        { hash: "m", parents: "a c" },
        { hash: "a", parents: "root" },
        { hash: "c", parents: "c1" },
        { hash: "c1", parents: "root" },
        { hash: "root" },
      ),
    );

    // Row 0 (m): allocates lanes 0 (a) and 1 (c) below
    expect(rows[0].column).toBe(0);
    expect(rows[0].lanesToBottom).toEqual([0, 1]);

    // Row 1 (a): main, both feature lanes still alive
    expect(rows[1].column).toBe(0);
    expect(rows[1].lanesToBottom).toContain(0);
    expect(rows[1].lanesToBottom).toContain(1);

    // Row 2 (c): on lane 1, lane 0 (a's parent=root) survives
    expect(rows[2].column).toBe(1);

    // After c1 (row 3) merges back into root, the c-branch lane terminates
    // but root continues. Verify no row leaves a stray empty interior column.
    for (const row of rows) {
      // bottom-frame columns must be contiguous from 0
      const sorted = [...row.lanesToBottom].sort((a, b) => a - b);
      for (let i = 0; i < sorted.length; i++) {
        expect(sorted[i]).toBe(i);
      }
    }
  });

  it("keeps a lane's color consistent across the merge-base row", () => {
    // Main merges feature back in. Walking newest→oldest, the feature tip's
    // hash is registered as a fork destination with a fresh color before
    // main's traversal reaches the merge-base. The main lane must not flip
    // to that fork color when it lands on the shared merge-base commit.
    const rows = buildGraphLanes(
      commits(
        { hash: "A", parents: "M" },
        { hash: "M", parents: "B X" },
        { hash: "B", parents: "X" },
        { hash: "X" },
      ),
    );

    const mainColor = rows[0].color;
    expect(rows[1].color).toBe(mainColor); // M sits on the main lane
    expect(rows[2].color).toBe(mainColor); // B sits on the main lane
    expect(rows[3].color).toBe(mainColor); // X (merge-base) — must not flip
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
