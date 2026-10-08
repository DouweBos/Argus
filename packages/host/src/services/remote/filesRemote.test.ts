/**
 * The phone's read-only file methods: confined to the session's own worktree
 * (never an absolute path or another registered project), and a search can
 * only be cancelled through the session that started it.
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
const { cancelSessionSearch, readSessionFile } = await import("./filesRemote");
const { startCodeSearch, stopCodeSearches } = await import("../code/search");

let worktree: string;
let project: string;

const tmp = async (prefix: string) =>
  fs.promises.realpath(
    await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix)),
  );

describe("phone file methods", () => {
  beforeEach(async () => {
    worktree = await tmp("argus-files-ws-");
    project = await tmp("argus-files-project-");
    appState.sessions.clear();
    appState.repoRoots.clear();
    appState.sessions.set("s1", { path: worktree } as never);
    appState.sessions.set("s2", { path: project } as never);
    appState.repoRoots.add(project);
    await fs.promises.writeFile(path.join(worktree, "a.ts"), "hello");
    await fs.promises.writeFile(path.join(project, "secret.ts"), "shh");
    await fs.promises.symlink(
      path.join(project, "secret.ts"),
      path.join(worktree, "link.ts"),
    );
  });

  afterEach(async () => {
    stopCodeSearches();
    for (const dir of [worktree, project]) {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });

  it("reads a session file", async () => {
    await expect(readSessionFile("s1", "a.ts")).resolves.toMatchObject({
      content: "hello",
      eol: "lf",
    });
  });

  it("refuses absolute paths and other projects, even through a symlink", async () => {
    await expect(
      readSessionFile("s1", path.join(project, "secret.ts")),
    ).rejects.toMatch(/relative/);
    await expect(readSessionFile("s1", "link.ts")).rejects.toMatch(
      /outside this session/,
    );
  });

  it("only cancels a search through its own session", () => {
    startCodeSearch(
      "s1",
      { query: "x", regex: false, caseSensitive: false, wholeWord: false },
      "q1",
    );
    expect(cancelSessionSearch("s2", "q1")).toEqual({ accepted: false });
    expect(cancelSessionSearch("s1", "q1")).toEqual({ accepted: true });
  });
});
