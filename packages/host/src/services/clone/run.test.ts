import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLONE_CANCELLED, runClone } from "./run";

describe("runClone", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "argus-clone-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("running", () => {
    it("clones and reports progress", async () => {
      const origin = path.join(dir, "origin");
      fs.mkdirSync(origin);
      const git = (...args: string[]) =>
        execFileSync("git", args, { cwd: origin, stdio: "ignore" });
      git("init", "-b", "main");
      fs.writeFileSync(path.join(origin, "README.md"), "# hi\n");
      git("add", "README.md");
      git(
        "-c",
        "user.email=a@b.c",
        "-c",
        "user.name=a",
        "commit",
        "-m",
        "init",
      );

      const dest = path.join(dir, "copy");
      const phases = new Set<string>();
      await runClone({
        program: "git",
        args: ["clone", "--progress", "--", `file://${origin}`, dest],
        dest,
        onProgress: (p) => phases.add(p.phase),
      });
      expect(fs.existsSync(path.join(dest, "README.md"))).toBe(true);
      expect(phases.size).toBeGreaterThan(0);
    });

    it("removes the partial folder when cancelled", async () => {
      const dest = path.join(dir, "partial");
      const abort = new AbortController();
      const progress: number[] = [];
      // Stands in for a slow clone: makes the folder, reports, then hangs.
      const running = runClone({
        program: "sh",
        args: [
          "-c",
          `mkdir -p "${dest}/.git"; echo 'Receiving objects:  10% (1/10)' >&2; sleep 30`,
        ],
        dest,
        signal: abort.signal,
        onProgress: (p) => {
          progress.push(p.percent ?? -1);
          abort.abort();
        },
      });
      await expect(running).rejects.toBe(CLONE_CANCELLED);
      expect(progress).toEqual([10]);
      expect(fs.existsSync(dest)).toBe(false);
    });

    it("removes the folder and explains a failed clone", async () => {
      const dest = path.join(dir, "missing");
      await expect(
        runClone({
          program: "git",
          args: ["clone", "--progress", "--", path.join(dir, "nope"), dest],
          dest,
        }),
      ).rejects.toMatch(/not found|does not exist|not appear/i);
      expect(fs.existsSync(dest)).toBe(false);
    });

    it("refuses a destination that exists", async () => {
      await expect(
        runClone({ program: "git", args: [], dest: dir }),
      ).rejects.toMatch(/already exists/);
    });
  });
});
