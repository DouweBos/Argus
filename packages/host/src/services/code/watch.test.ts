/**
 * Watching open files: one directory watch shared by its files, held per
 * connection, debounced, and silent unless the bytes really changed.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addHostEventSink,
  emitHostEvent,
  resetHostEventSinks,
} from "@argus/host/bus";

vi.mock("../../state", () => ({
  appState: {
    sessions: new Map<string, { path: string }>(),
    repoRoots: new Set<string>(),
  },
}));
vi.mock("../session/git", () => ({ git: vi.fn(async () => "") }));

const { appState } = await import("../../state");
const { closeConnection, runInConnection } =
  await import("../remote/connectionScope");
const { sha1, writeCodeFile } = await import("./files");
const watch = await import("./watch");

let worktree: string;
let events: { channel: string; payload: unknown }[];
/** Directory → the change callback the fake watcher registered. */
let triggers: Map<string, (name: string | null) => void>;

const file = (rel: string) => path.join(worktree, rel);
const changes = () =>
  events
    .filter((e) => e.channel === "code:file-changed:s1")
    .map((e) => e.payload);

describe("code file watching", () => {
  beforeEach(async () => {
    worktree = await fs.promises.realpath(
      await fs.promises.mkdtemp(path.join(os.tmpdir(), "argus-watch-")),
    );
    appState.sessions.clear();
    appState.sessions.set("s1", { path: worktree } as never);
    await fs.promises.mkdir(file("src"));
    await fs.promises.writeFile(file("src/a.ts"), "a");
    await fs.promises.writeFile(file("src/b.ts"), "b");
    events = [];
    triggers = new Map();
    resetHostEventSinks();
    addHostEventSink((channel, args) =>
      events.push({ channel, payload: args[0] }),
    );
    watch.setWatchDirForTest((dir, onChange) => {
      triggers.set(dir, onChange);

      return () => triggers.delete(dir);
    });
    watch.initCodeWatches();
  });

  afterEach(async () => {
    watch.stopCodeWatches();
    watch.setWatchDirForTest(null);
    resetHostEventSinks();
    await fs.promises.rm(worktree, { recursive: true, force: true });
  });

  it("shares one directory watch between files and drops it with the last", async () => {
    await watch.watchCodeFiles("s1", ["src/a.ts", "src/b.ts"]);
    expect(watch.watchedCodeDirs()).toEqual([file("src")]);
    await watch.unwatchCodeFiles("s1", ["src/a.ts"]);
    expect(watch.watchedCodeDirs()).toEqual([file("src")]);
    await watch.unwatchCodeFiles("s1", ["src/b.ts"]);
    expect(watch.watchedCodeDirs()).toEqual([]);
  });

  it("holds a file per connection until every holder lets go", async () => {
    await runInConnection("c1", () => watch.watchCodeFiles("s1", ["src/a.ts"]));
    await runInConnection("c2", () => watch.watchCodeFiles("s1", ["src/a.ts"]));
    expect(watch.watchedCodeFiles()).toEqual([
      { path: "src/a.ts", holders: 2 },
    ]);
    closeConnection("c1");
    expect(watch.watchedCodeFiles()).toEqual([
      { path: "src/a.ts", holders: 1 },
    ]);
    await runInConnection("c2", () =>
      watch.unwatchCodeFiles("s1", ["src/a.ts"]),
    );
    expect(watch.watchedCodeFiles()).toEqual([]);
    expect(watch.watchedCodeDirs()).toEqual([]);
  });

  it("debounces a burst into one event carrying the new hash", async () => {
    await watch.watchCodeFiles("s1", ["src/a.ts"]);
    await fs.promises.writeFile(file("src/a.ts"), "changed");
    const fire = triggers.get(file("src"))!;
    fire("a.ts");
    fire("a.ts");
    fire(null);
    await vi.waitFor(() => expect(changes()).toHaveLength(1));
    expect(changes()[0]).toEqual({
      relativePath: "src/a.ts",
      hash: sha1(Buffer.from("changed")),
      mtimeMs: fs.statSync(file("src/a.ts")).mtimeMs,
    });
    await new Promise((r) => setTimeout(r, watch.FILE_CHANGE_DEBOUNCE_MS * 2));
    expect(changes()).toHaveLength(1);
  });

  it("stays quiet when the bytes didn't change, or for a sibling", async () => {
    await watch.watchCodeFiles("s1", ["src/a.ts"]);
    const fire = triggers.get(file("src"))!;
    fire("a.ts");
    await fs.promises.writeFile(file("src/b.ts"), "other");
    fire("b.ts");
    await new Promise((r) => setTimeout(r, watch.FILE_CHANGE_DEBOUNCE_MS * 3));
    expect(changes()).toEqual([]);
  });

  it("reports a deletion with a null hash", async () => {
    await watch.watchCodeFiles("s1", ["src/a.ts"]);
    await fs.promises.rm(file("src/a.ts"));
    triggers.get(file("src"))!("a.ts");
    await vi.waitFor(() =>
      expect(changes()).toEqual([
        { relativePath: "src/a.ts", hash: null, mtimeMs: null },
      ]),
    );
  });

  it("doesn't echo the editor's own save back", async () => {
    await watch.watchCodeFiles("s1", ["src/a.ts"]);
    await writeCodeFile("s1", "src/a.ts", "saved", sha1(Buffer.from("a")));
    triggers.get(file("src"))!("a.ts");
    await new Promise((r) => setTimeout(r, watch.FILE_CHANGE_DEBOUNCE_MS * 3));
    expect(changes()).toEqual([]);
  });

  it("drops a deleted session's watches", async () => {
    await watch.watchCodeFiles("s1", ["src/a.ts"]);
    emitHostEvent("session:deleted", "s1");
    expect(watch.watchedCodeFiles()).toEqual([]);
    expect(watch.watchedCodeDirs()).toEqual([]);
  });

  it("sees a real write through fs.watch", async () => {
    watch.setWatchDirForTest(null);
    await watch.watchCodeFiles("s1", ["src/a.ts"]);
    await fs.promises.writeFile(file("src/a.ts"), "from an agent");
    await vi.waitFor(
      () =>
        expect(changes()).toEqual([
          expect.objectContaining({
            relativePath: "src/a.ts",
            hash: sha1(Buffer.from("from an agent")),
          }),
        ]),
      { timeout: 3000 },
    );
  });
});
