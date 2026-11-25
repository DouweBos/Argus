import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../telemetry/telemetry", () => ({ capture: vi.fn() }));
vi.mock("../appSettings/store", () => ({
  loadAppSettings: () => settings,
  saveAppSettings: vi.fn(),
}));

let settings: { clone_parent_dir?: string };
const { appState } = await import("../../state");
const jobs = await import("./jobs");

describe("clone jobs", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "argus-clone-jobs-"));
    settings = {};
    appState.repoRoots.clear();
    jobs.resetCloneState();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("previewClone", () => {
    it("names the folder after the repository and checks it is free", () => {
      expect(jobs.previewClone({ url: "octo/tally", parent_dir: dir })).toEqual(
        {
          url_kind: "shorthand",
          name: "tally",
          path: path.join(dir, "tally"),
          problem: null,
        },
      );
      fs.mkdirSync(path.join(dir, "tally"));
      expect(
        jobs.previewClone({ url: "octo/tally", parent_dir: dir }).problem,
      ).toMatch(/already exists/);
      expect(
        jobs.previewClone({ url: "octo/tally", parent_dir: dir, name: "fresh" })
          .problem,
      ).toBeNull();
    });

    it("refuses an option for an address and a path for a name", () => {
      expect(
        jobs.previewClone({ url: "--upload-pack=x", parent_dir: dir }).problem,
      ).toMatch(/dash/);
      expect(
        jobs.previewClone({ url: "octo/tally", parent_dir: dir, name: "../x" })
          .problem,
      ).not.toBeNull();
    });
  });

  describe("cloneDefaults", () => {
    it("prefers the remembered folder, then where most projects live", async () => {
      appState.repoRoots.add("/work/a");
      appState.repoRoots.add("/work/b");
      appState.repoRoots.add("/other/c");
      const fromProjects = await jobs.cloneDefaults();
      expect(fromProjects.parent_dir).toBe("/work");
      expect(fromProjects.parents).toEqual(["/work", "/other"]);

      settings = { clone_parent_dir: "/remembered" };
      const remembered = await jobs.cloneDefaults();
      expect(remembered.parent_dir).toBe("/remembered");
      expect(remembered.parents).toEqual(["/remembered", "/work", "/other"]);
    });

    it("falls back to ~/Developer", async () => {
      expect((await jobs.cloneDefaults()).parent_dir).toBe(
        path.join(os.homedir(), "Developer"),
      );
    });
  });
});
