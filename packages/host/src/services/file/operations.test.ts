/**
 * Path containment for the file commands an admin device can reach: the
 * @-mention browser, and `read_file`/`write_file`. Nothing outside the session
 * worktree and the registered project roots resolves — while cross-project
 * mentions and edits into those projects keep working.
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
const { readFile, resolveMentionPath, writeFile } =
  await import("./operations");

const WORKTREE = path.join(os.tmpdir(), "argus-mention-session");
const OTHER_PROJECT = path.join(os.tmpdir(), "argus-mention-other");

describe("resolveMentionPath containment", () => {
  beforeEach(() => {
    appState.sessions.clear();
    appState.sessions.set("s1", { path: WORKTREE } as never);
  });

  it("rejects paths outside the session and the allowed project roots", async () => {
    for (const query of ["~/.ssh/", "/etc/", "../../"]) {
      const res = await resolveMentionPath("s1", query, [OTHER_PROJECT]);
      expect(res.entries).toEqual([]);
      expect(res.resolvedPath).toBe(WORKTREE);
    }
  });

  it("still allows another registered project", async () => {
    const res = await resolveMentionPath("s1", `${OTHER_PROJECT}/`, [
      OTHER_PROJECT,
    ]);
    expect(res.resolvedPath).toBe(OTHER_PROJECT);
  });

  it("leaves the local (unconfined) browse alone", async () => {
    const res = await resolveMentionPath("s1", "/etc/");
    expect(res.resolvedPath).toBe("/etc");
  });
});

describe("read/write containment", () => {
  let worktree: string;
  let outside: string;

  beforeEach(async () => {
    worktree = await fs.promises.mkdtemp(path.join(os.tmpdir(), "argus-ws-"));
    outside = await fs.promises.mkdtemp(path.join(os.tmpdir(), "argus-out-"));
    appState.sessions.clear();
    appState.repoRoots.clear();
    appState.sessions.set("s1", { path: worktree } as never);
    await fs.promises.writeFile(path.join(outside, "secret.txt"), "shh");
  });

  afterEach(async () => {
    await fs.promises.rm(worktree, { recursive: true, force: true });
    await fs.promises.rm(outside, { recursive: true, force: true });
  });

  it("reads a file inside the session", async () => {
    await fs.promises.writeFile(path.join(worktree, "a.txt"), "hello");
    await expect(readFile("s1", "a.txt")).resolves.toBe("hello");
  });

  it("rejects a traversal out of the session", async () => {
    await expect(
      readFile("s1", path.join("..", path.basename(outside), "secret.txt")),
    ).rejects.toMatch(/outside this session/);
  });

  it("rejects an absolute path outside every known root", async () => {
    await expect(
      readFile("s1", path.join(outside, "secret.txt")),
    ).rejects.toMatch(/outside this session/);
  });

  it("rejects a symlink pointing out of the session", async () => {
    await fs.promises.symlink(outside, path.join(worktree, "link"));
    await expect(readFile("s1", "link/secret.txt")).rejects.toMatch(
      /outside this session/,
    );
    await expect(writeFile("s1", "link/new.txt", "x")).rejects.toMatch(
      /outside this session/,
    );
    await expect(
      fs.promises.access(path.join(outside, "new.txt")),
    ).rejects.toThrow();
  });

  it("allows a registered project root", async () => {
    appState.repoRoots.add(outside);
    await expect(
      readFile("s1", path.join(outside, "secret.txt")),
    ).resolves.toBe("shh");
  });

  it("creates parent directories for a new file in the session", async () => {
    await writeFile("s1", "nested/deep/file.txt", "written");
    await expect(
      fs.promises.readFile(path.join(worktree, "nested/deep/file.txt"), "utf8"),
    ).resolves.toBe("written");
  });
});
