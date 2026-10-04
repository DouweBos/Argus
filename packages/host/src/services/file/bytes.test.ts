/**
 * The binary file primitives a remote git runner uses: containment matches
 * `read_file` (session worktree + registered projects, symlinks resolved), and
 * remove/move act on a symlink itself, never through it.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../state", () => ({
  appState: {
    sessions: new Map<string, { path: string }>(),
    repoRoots: new Set<string>(),
  },
}));
vi.mock("../session/git", () => ({ git: vi.fn(async () => "") }));

const { appState } = await import("../../state");
const {
  listDirectory,
  makeDirectory,
  movePath,
  readFileBytes,
  removePath,
  statPath,
  writeFileBytes,
} = await import("./bytes");

let worktree: string;
let project: string;
let outside: string;

const tmp = async (prefix: string) =>
  fs.promises.realpath(
    await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix)),
  );

describe("remote git runner file primitives", () => {
  beforeEach(async () => {
    worktree = await tmp("argus-bytes-ws-");
    project = await tmp("argus-bytes-project-");
    outside = await tmp("argus-bytes-out-");
    appState.sessions.clear();
    appState.repoRoots.clear();
    appState.sessions.set("s1", { path: worktree } as never);
    appState.repoRoots.add(project);
    await fs.promises.writeFile(path.join(outside, "secret"), "shh");
  });

  afterEach(async () => {
    for (const dir of [worktree, project, outside]) {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });

  describe("read/write bytes", () => {
    it("round-trips binary data, creating parents", async () => {
      const bytes = Buffer.from([0, 1, 2, 255, 0, 10]);
      await writeFileBytes("s1", "deep/dir/blob.bin", bytes.toString("base64"));
      await expect(
        fs.promises.readFile(path.join(worktree, "deep/dir/blob.bin")),
      ).resolves.toEqual(bytes);
      expect(
        Buffer.from(await readFileBytes("s1", "deep/dir/blob.bin"), "base64"),
      ).toEqual(bytes);
    });

    it("marks a file executable on request and leaves no temp behind", async () => {
      await writeFileBytes("s1", "run.sh", "", true);
      expect(fs.statSync(path.join(worktree, "run.sh")).mode & 0o777).toBe(
        0o755,
      );
      await writeFileBytes("s1", "run.sh", "");
      expect(fs.statSync(path.join(worktree, "run.sh")).mode & 0o777).toBe(
        0o644,
      );
      await expect(fs.promises.readdir(worktree)).resolves.toEqual(["run.sh"]);
    });

    it("accepts absolute paths inside a registered project", async () => {
      const target = path.join(project, ".git", "worktrees", "x", "todo");
      await writeFileBytes(
        "s1",
        target,
        Buffer.from("pick").toString("base64"),
      );
      await expect(fs.promises.readFile(target, "utf8")).resolves.toBe("pick");
    });

    it("refuses `..` out of the allowed roots", async () => {
      const escape = path.join("..", path.basename(outside), "secret");
      await expect(readFileBytes("s1", escape)).rejects.toMatch(/outside/);
      await expect(writeFileBytes("s1", escape, "")).rejects.toMatch(/outside/);
    });

    it("refuses a symlink that escapes", async () => {
      await fs.promises.symlink(outside, path.join(worktree, "link"));
      await expect(readFileBytes("s1", "link/secret")).rejects.toMatch(
        /outside/,
      );
      await expect(writeFileBytes("s1", "link/new", "")).rejects.toMatch(
        /outside/,
      );
      await expect(listDirectory("s1", "link")).rejects.toMatch(/outside/);
    });
  });

  describe("stat_path", () => {
    it("reports files, directories and absence", async () => {
      await fs.promises.mkdir(path.join(worktree, "d"));
      await fs.promises.writeFile(path.join(worktree, "f"), "");
      await expect(statPath("s1", "d")).resolves.toEqual({ kind: "directory" });
      await expect(statPath("s1", "f")).resolves.toEqual({ kind: "file" });
      await expect(statPath("s1", "missing/deeper")).resolves.toBeNull();
    });

    it("refuses outside paths rather than answering null", async () => {
      await expect(
        statPath("s1", path.join(outside, "secret")),
      ).rejects.toMatch(/outside/);
    });
  });

  describe("directory operations", () => {
    it("lists, makes and removes", async () => {
      await makeDirectory("s1", "a/b/c");
      await makeDirectory("s1", "a/b/c");
      await fs.promises.writeFile(path.join(worktree, "a", "z"), "");
      await expect(listDirectory("s1", "a")).resolves.toEqual(["b", "z"]);
      await removePath("s1", "a");
      expect(fs.existsSync(path.join(worktree, "a"))).toBe(false);
    });

    it("errors removing something missing", async () => {
      await expect(removePath("s1", "nope")).rejects.toMatch(/No such/);
    });

    it("removes a symlink without following it", async () => {
      await fs.promises.symlink(outside, path.join(worktree, "link"));
      await removePath("s1", "link");
      expect(fs.existsSync(path.join(outside, "secret"))).toBe(true);
      expect(fs.existsSync(path.join(worktree, "link"))).toBe(false);
    });

    it("never removes a session or project root", async () => {
      await expect(removePath("s1", worktree)).rejects.toBeDefined();
      await expect(removePath("s1", project)).rejects.toBeDefined();
      expect(fs.existsSync(worktree)).toBe(true);
      expect(fs.existsSync(project)).toBe(true);
    });

    it("moves within the roots and refuses moving out", async () => {
      await fs.promises.writeFile(path.join(worktree, "from"), "x");
      await movePath("s1", "from", "to");
      await expect(
        fs.promises.readFile(path.join(worktree, "to"), "utf8"),
      ).resolves.toBe("x");
      await expect(
        movePath("s1", "to", path.join(outside, "stolen")),
      ).rejects.toMatch(/outside/);
      await expect(
        movePath("s1", path.join(outside, "secret"), "mine"),
      ).rejects.toMatch(/outside/);
    });
  });
});
