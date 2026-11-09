import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  conductorWorkspaceRoots,
  isConductorWorkspacePath,
  workspacePathsInSettings,
} from "./conductorWorkspaces";

describe("conductor workspaces", () => {
  let home: string;

  beforeEach(() => {
    home = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "argus-home-")),
    );
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  describe("conductorWorkspaceRoots", () => {
    it("defaults to ~/conductor", () => {
      expect(conductorWorkspaceRoots(home)).toEqual([
        path.join(home, "conductor"),
      ]);
      expect(
        isConductorWorkspacePath(
          path.join(home, "conductor", "workspaces", "app", "lisbon"),
          home,
        ),
      ).toBe(true);
      expect(isConductorWorkspacePath(path.join(home, "code"), home)).toBe(
        false,
      );
    });

    it("adds a location set in ~/.conductor/settings.toml", () => {
      fs.mkdirSync(path.join(home, ".conductor"));
      fs.writeFileSync(
        path.join(home, ".conductor", "settings.toml"),
        `[workspaces]\ndefault_workspace_location = "~/dev/ws"\nname = "x"\n`,
      );
      expect(conductorWorkspaceRoots(home)).toContain(
        path.join(home, "dev", "ws"),
      );
    });
  });

  describe("workspacePathsInSettings", () => {
    it("finds workspace-location keys at any depth", () => {
      expect(
        workspacePathsInSettings({
          workspace_dir: "/a",
          git: { branch_prefix: "x" },
          nested: { workspaces_root: "/b", workspace_count: 3 },
        }),
      ).toEqual(["/a", "/b"]);
    });
  });
});
