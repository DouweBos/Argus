/**
 * The symbol index against a real git repo and the bundled ripgrep: a lazy
 * build that honours `.gitignore` and the size cap, fuzzy ranking, patching
 * changed files, rebuilding on a new HEAD, and dropping on idle or deletion.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emitHostEvent, resetHostEventSinks } from "@argus/host/bus";

vi.mock("../../state", () => ({
  appState: {
    sessions: new Map<string, { path: string }>(),
    repoRoots: new Set<string>(),
  },
}));

const { appState } = await import("../../state");
const { ripgrepPath } = await import("./bundled");
const symbols = await import("./symbols");

const hasRg = fs.existsSync(ripgrepPath());
let repo: string;

const sh = (...args: string[]) =>
  execFileSync("git", args, { cwd: repo, stdio: "pipe" });

function write(rel: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), text);
}

const names = async (
  query: string,
  kinds?: Parameters<typeof symbols.searchSymbols>[3],
) =>
  (await symbols.searchSymbols("s1", query, 20, kinds)).symbols.map(
    (s) =>
      `${s.container ? `${s.container}.` : ""}${s.name} ${s.relativePath}:${s.line}`,
  );

describe.skipIf(!hasRg)("symbol index", () => {
  beforeEach(async () => {
    repo = await fs.promises.realpath(
      await fs.promises.mkdtemp(path.join(os.tmpdir(), "argus-sym-")),
    );
    appState.sessions.set("s1", { path: repo } as never);
    sh("init", "-q");
    sh("config", "user.email", "t@example.com");
    sh("config", "user.name", "t");
    write(".gitignore", "build/\n");
    write(
      "Sources/Store.swift",
      "final class Store {\n  func loadItems() {}\n}\n",
    );
    write(
      "src/store.ts",
      "export function storeHelper() {}\nexport interface StoreProps {}\n",
    );
    write("build/Generated.swift", "class GeneratedStore {}\n");
    write("big.swift", `class TooBigStore {}\n${"// x\n".repeat(300_000)}`);
    write("notes.md", "class NotCode\n");
    sh("add", ".");
    sh("commit", "-qm", "init");
    resetHostEventSinks();
    symbols.SYMBOL_TIMING.refreshDebounceMs = 10;
    symbols.initSymbolIndex();
  });

  afterEach(async () => {
    symbols.stopSymbolIndex();
    resetHostEventSinks();
    appState.sessions.clear();
    await fs.promises.rm(repo, { recursive: true, force: true });
  });

  it("builds on first use, skipping ignored, oversized and unknown files", async () => {
    const result = await symbols.searchSymbols("s1", "store");
    expect(result.complete).toBe(true);
    expect(result.symbols.map((s) => s.name)).toEqual([
      "Store",
      "StoreProps",
      "storeHelper",
    ]);
    expect(result.symbols[0]).toEqual({
      name: "Store",
      kind: "class",
      relativePath: "Sources/Store.swift",
      line: 1,
      column: 12,
    });
  });

  it("ranks exact and prefix names first and filters by kind", async () => {
    await expect(names("li")).resolves.toEqual([
      "Store.loadItems Sources/Store.swift:2",
    ]);
    await expect(names("store", ["function", "method"])).resolves.toEqual([
      "storeHelper src/store.ts:1",
    ]);
    await expect(names("")).resolves.toEqual([]);
  });

  it("patches changed files when git reports a change", async () => {
    await names("store");
    write("src/store.ts", "export function renamedHelper() {}\n");
    write("src/extra.py", "class ExtraStore:\n    pass\n");
    emitHostEvent("git_status_changed", { sessionId: "s1" });
    await vi.waitFor(
      async () =>
        await expect(names("store")).resolves.toEqual([
          "Store Sources/Store.swift:1",
          "ExtraStore src/extra.py:1",
        ]),
    );
    await expect(names("renamed")).resolves.toEqual([
      "renamedHelper src/store.ts:1",
    ]);
    fs.rmSync(path.join(repo, "src/extra.py"));
    emitHostEvent("session:diff-changed:s1", {});
    await vi.waitFor(
      async () => await expect(names("extra")).resolves.toEqual([]),
    );
  });

  it("rebuilds after HEAD moves", async () => {
    await names("store");
    write("Sources/New.swift", "struct Fresh {}\n");
    sh("add", ".");
    sh("commit", "-qm", "two");
    emitHostEvent("git_status_changed", { sessionId: "s1" });
    await vi.waitFor(
      async () =>
        await expect(names("fresh")).resolves.toEqual([
          "Fresh Sources/New.swift:1",
        ]),
    );
  });

  it("drops the index when the session goes or after idling", async () => {
    await names("store");
    expect(symbols.symbolIndexStats("s1")).toEqual({ files: 2, symbols: 4 });
    emitHostEvent("session:deleted", "s1");
    expect(symbols.symbolIndexStats("s1")).toBeNull();

    symbols.SYMBOL_TIMING.idleEvictMs = 200;
    try {
      await names("store");
      expect(symbols.symbolIndexStats("s1")).not.toBeNull();
      await vi.waitFor(() => expect(symbols.symbolIndexStats("s1")).toBeNull());
    } finally {
      symbols.SYMBOL_TIMING.idleEvictMs = 10 * 60_000;
    }
  });
});

describe("symbol ranking", () => {
  const sym = (
    name: string,
    kind: "class" | "method" | "variable" = "method",
  ) => ({
    name,
    kind,
    relativePath: "a.ts",
    line: 1,
    column: 0,
  });

  it("puts exact over prefix over scattered, and types over members on a tie", () => {
    const ranked = symbols.rankSymbols(
      [
        [
          sym("fooBarBaz"),
          sym("food"),
          sym("foo"),
          sym("xfoo"),
          sym("foo", "class"),
          sym("fbo"),
        ],
      ],
      "foo",
      10,
    );
    expect(ranked.map((s) => `${s.kind} ${s.name}`)).toEqual([
      "class foo",
      "method foo",
      "method food",
      "method fooBarBaz",
      "method xfoo",
    ]);
  });

  it("keeps the best when there are more matches than the limit", () => {
    const many = Array.from({ length: 5000 }, (_, i) => sym(`item${i}`));
    many.push(sym("item"));
    expect(symbols.rankSymbols([many], "item", 3)[0].name).toBe("item");
  });
});
