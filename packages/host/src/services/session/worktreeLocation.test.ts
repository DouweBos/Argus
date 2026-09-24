import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeWorktreesRoot,
  isInsideRoot,
  worktreeDirName,
} from "./worktreeLocation";

describe("computeWorktreesRoot", () => {
  const argusHome = "/home/me/.argus";
  const repoRoot = "/home/me/Projects/MyApp";

  it("keeps the built-in location byte-identical", () => {
    // Every existing install resolves through here; a different string would
    // orphan every worktree already on disk.
    expect(computeWorktreesRoot({ repoRoot, argusHome })).toEqual({
      root: "/home/me/.argus/worktrees/MyApp-argus-worktrees",
      source: "default",
    });
  });

  it("sends automations to their own base, project first", () => {
    const bases = {
      appBase: "/Volumes/SSD/wt",
      automationAppBase: "/Volumes/Bulk/wt",
      automationProjectBase: "/Volumes/Archive/wt",
      projectBase: "/Volumes/Fast/wt",
    };

    expect(
      computeWorktreesRoot({
        repoRoot,
        argusHome,
        purpose: "automation",
        ...bases,
      }),
    ).toEqual({
      root: "/Volumes/Archive/wt/MyApp-argus-worktrees",
      source: "automation_project",
    });

    expect(
      computeWorktreesRoot({
        repoRoot,
        argusHome,
        purpose: "automation",
        ...bases,
        automationProjectBase: "  ",
      }),
    ).toEqual({
      root: "/Volumes/Bulk/wt/MyApp-argus-worktrees",
      source: "automation_app",
    });
  });

  it("falls through to the user cascade when no automation base is set", () => {
    // The two purposes must agree exactly, or turning the setting off would
    // strand every automation worktree.
    const args = {
      repoRoot,
      argusHome,
      appBase: "/Volumes/SSD/wt",
      projectBase: "/Volumes/Fast/wt",
    };

    expect(computeWorktreesRoot({ ...args, purpose: "automation" })).toEqual(
      computeWorktreesRoot({ ...args, purpose: "user" }),
    );
    expect(
      computeWorktreesRoot({ repoRoot, argusHome, purpose: "automation" }),
    ).toEqual(computeWorktreesRoot({ repoRoot, argusHome }));
  });

  it("ignores the automation base for the user's own worktrees", () => {
    expect(
      computeWorktreesRoot({
        repoRoot,
        argusHome,
        automationAppBase: "/Volumes/Bulk/wt",
        automationProjectBase: "/Volumes/Archive/wt",
      }),
    ).toEqual({
      root: "/home/me/.argus/worktrees/MyApp-argus-worktrees",
      source: "default",
    });
  });

  it("puts the repo folder under an app-wide base", () => {
    expect(
      computeWorktreesRoot({ repoRoot, argusHome, appBase: "/Volumes/SSD/wt" }),
    ).toEqual({
      root: "/Volumes/SSD/wt/MyApp-argus-worktrees",
      source: "app",
    });
  });

  it("lets a project override the app-wide base", () => {
    expect(
      computeWorktreesRoot({
        repoRoot,
        argusHome,
        appBase: "/Volumes/SSD/wt",
        projectBase: "/Volumes/Fast/wt",
      }),
    ).toEqual({
      root: "/Volumes/Fast/wt/MyApp-argus-worktrees",
      source: "project",
    });
  });

  it("treats a blank setting as unset", () => {
    expect(
      computeWorktreesRoot({
        repoRoot,
        argusHome,
        appBase: "  ",
        projectBase: "",
      }).source,
    ).toBe("default");
  });

  it("gives two repos sharing a base their own directories", () => {
    const base = "/Volumes/SSD/wt";
    const a = computeWorktreesRoot({
      repoRoot: "/a/MyApp",
      argusHome,
      appBase: base,
    });
    const b = computeWorktreesRoot({
      repoRoot: "/b/Other",
      argusHome,
      appBase: base,
    });

    expect(a.root).not.toBe(b.root);
  });
});

describe("worktreeDirName", () => {
  it("falls back when the repo path has no basename", () => {
    expect(worktreeDirName("/")).toBe("repo-argus-worktrees");
  });
});

describe("isInsideRoot", () => {
  const root = "/Volumes/SSD/MyApp-argus-worktrees";

  it("accepts the root and its children", () => {
    expect(isInsideRoot(root, root)).toBe(true);
    expect(isInsideRoot(root, path.join(root, "feature"))).toBe(true);
  });

  it("rejects a sibling whose name merely starts the same", () => {
    // The bug `startsWith` had: this directory is a different root entirely.
    expect(isInsideRoot(root, `${root}-backup/feature`)).toBe(false);
  });
});
