import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSessionProgress,
  countedDirs,
  countEntries,
  getSessionProgress,
  lastOutputLine,
  setSessionProgress,
  trackDeleteProgress,
} from "./progress";

const emitHostEvent = vi.hoisted(() => vi.fn());
vi.mock("@argus/host/bus", () => ({ emitHostEvent }));

let root: string;

const touch = (...parts: string[]) => {
  const file = path.join(root, ...parts);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "");
};

describe("session progress", () => {
  beforeEach(() => {
    emitHostEvent.mockClear();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "argus-progress-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe("lastOutputLine", () => {
    it("returns the last line with content", () => {
      expect(lastOutputLine("one\r\ntwo\r\n\r\n")).toBe("two");
    });

    it("reads a redrawn line as its latest state", () => {
      expect(lastOutputLine("added 1\radded 2\radded 3")).toBe("added 3");
    });

    it("is null for blank output", () => {
      expect(lastOutputLine(" \r\n")).toBeNull();
    });
  });

  describe("countedDirs", () => {
    it("counts one level down, plus pnpm's virtual store", async () => {
      touch("README.md");
      touch("src", "a.ts");
      touch("node_modules", ".pnpm", "pkg", "index.js");

      expect((await countedDirs(root)).sort()).toEqual(
        [
          root,
          path.join(root, "node_modules"),
          path.join(root, "node_modules", ".pnpm"),
          path.join(root, "src"),
        ].sort(),
      );
    });

    it("falls back to the root when it can't be listed", async () => {
      const missing = path.join(root, "gone");
      await expect(countedDirs(missing)).resolves.toEqual([missing]);
      await expect(countEntries([missing])).resolves.toBe(0);
    });
  });

  describe("setSessionProgress", () => {
    it("remembers the latest counts but broadcasts sparsely", () => {
      setSessionProgress("s1", { current: 1, total: 9 });
      setSessionProgress("s1", { current: 2, total: 9 });

      expect(getSessionProgress("s1")).toEqual({ current: 2, total: 9 });
      expect(emitHostEvent).toHaveBeenCalledTimes(1);
      expect(emitHostEvent).toHaveBeenCalledWith("session:progress", "s1");

      clearSessionProgress("s1");
      expect(getSessionProgress("s1")).toBeNull();
    });
  });

  describe("trackDeleteProgress", () => {
    it("reports entries as they disappear", async () => {
      touch("a.txt");
      touch("src", "a.ts");
      touch("src", "b.ts");
      const stop = await trackDeleteProgress("s2", root, 5);
      const progress = () =>
        emitHostEvent.mock.calls
          .filter(([channel]) => channel === "session:delete_progress:s2")
          .map(([, payload]) => payload);

      // root holds a.txt + src, src holds two files.
      expect(progress()).toEqual([{ current: 0, total: 4 }]);

      fs.rmSync(path.join(root, "src"), { recursive: true });
      await vi.waitFor(() =>
        expect(progress().at(-1)).toEqual({ current: 3, total: 4 }),
      );
      stop();
      clearSessionProgress("s2");
    });

    it("stays quiet for a worktree that is already gone", async () => {
      const stop = await trackDeleteProgress("s3", path.join(root, "gone"), 5);
      stop();

      expect(emitHostEvent).not.toHaveBeenCalled();
    });
  });
});
