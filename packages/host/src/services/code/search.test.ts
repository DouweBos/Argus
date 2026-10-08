/**
 * Worktree search through the bundled ripgrep, against a real git repo:
 * batches stream, `.gitignore` is honoured, results stop at the cap, and a
 * cancel kills `rg` and still ends with `done`.
 */

import type { CodeSearchEvent } from "@argus/remote-protocol";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addHostEventSink, resetHostEventSinks } from "@argus/host/bus";

vi.mock("../../state", () => ({
  appState: {
    sessions: new Map<string, { path: string }>(),
    repoRoots: new Set<string>(),
  },
}));

const { appState } = await import("../../state");
const { ripgrepPath } = await import("./bundled");
const { cancelCodeSearch, startCodeSearch, toMatches } =
  await import("./search");

const hasRg = fs.existsSync(ripgrepPath());

let repo: string;
let events: CodeSearchEvent[];

const query = (q: string, extra: object = {}) => ({
  query: q,
  regex: false,
  caseSensitive: false,
  wholeWord: false,
  ...extra,
});

function done(searchId: string): Promise<CodeSearchEvent & { kind: "done" }> {
  return vi.waitFor(
    () => {
      const end = events.find(
        (e) => e.kind === "done" && e.searchId === searchId,
      );
      if (!end || end.kind !== "done") {
        throw new Error("not done");
      }

      return end;
    },
    { timeout: 10_000 },
  );
}

function matches(searchId: string) {
  return events.flatMap((e) =>
    e.kind === "matches" && e.searchId === searchId ? e.matches : [],
  );
}

describe("toMatches", () => {
  it("converts byte offsets to UTF-16 and windows long lines", () => {
    const line = `${"é".repeat(300)}needle tail\n`;
    const start = Buffer.byteLength("é".repeat(300));
    const [m] = toMatches({
      type: "match",
      data: {
        path: { text: "./src/x.ts" },
        lines: { text: line },
        line_number: 7,
        submatches: [{ start, end: start + 6 }],
      },
    });
    expect(m).toMatchObject({
      relativePath: "src/x.ts",
      line: 7,
      column: 300,
      length: 6,
    });
    expect(m.preview.slice(m.column - m.previewOffset)).toMatch(/^needle/);
    expect(m.preview.length).toBeLessThanOrEqual(240);
  });
});

describe.skipIf(!hasRg)("code search", () => {
  beforeEach(async () => {
    repo = await fs.promises.realpath(
      await fs.promises.mkdtemp(path.join(os.tmpdir(), "argus-search-")),
    );
    execFileSync("git", ["init", "-q"], { cwd: repo });
    await fs.promises.writeFile(path.join(repo, ".gitignore"), "ignored/\n");
    await fs.promises.mkdir(path.join(repo, "src"));
    await fs.promises.mkdir(path.join(repo, "ignored"));
    await fs.promises.writeFile(
      path.join(repo, "src/a.ts"),
      "const Needle = 1;\nneedle(needle);\n",
    );
    await fs.promises.writeFile(
      path.join(repo, "src/b.swift"),
      "let needles = 2\n",
    );
    await fs.promises.writeFile(path.join(repo, "ignored/c.ts"), "needle\n");
    appState.sessions.clear();
    appState.sessions.set("s1", { path: repo } as never);
    events = [];
    resetHostEventSinks();
    addHostEventSink((channel, args) => {
      if (channel.startsWith("code:search:")) {
        events.push(args[0] as CodeSearchEvent);
      }
    });
  });

  afterEach(async () => {
    resetHostEventSinks();
    await fs.promises.rm(repo, { recursive: true, force: true });
  });

  it("streams matches and respects .gitignore", async () => {
    const { searchId } = startCodeSearch("s1", query("needle"), "t1");
    expect(searchId).toBe("t1");
    const end = await done("t1");
    expect(end).toMatchObject({ count: 4, truncated: false, cancelled: false });
    const found = matches("t1").map(
      (m) => `${m.relativePath}:${m.line}:${m.column}`,
    );
    expect(found.sort()).toEqual([
      "src/a.ts:1:6",
      "src/a.ts:2:0",
      "src/a.ts:2:7",
      "src/b.swift:1:4",
    ]);
  });

  it("honours case, whole word, regex and globs", async () => {
    startCodeSearch("s1", query("Needle", { caseSensitive: true }), "case");
    startCodeSearch("s1", query("needle", { wholeWord: true }), "word");
    startCodeSearch("s1", query("need(le|les)\\b", { regex: true }), "re");
    startCodeSearch("s1", query("needle", { include: ["*.swift"] }), "inc");
    startCodeSearch("s1", query("needle", { exclude: ["*.swift"] }), "exc");
    expect((await done("case")).count).toBe(1);
    expect((await done("word")).count).toBe(3);
    expect((await done("re")).count).toBe(4);
    expect(matches("inc").map((m) => m.relativePath)).toEqual(["src/b.swift"]);
    expect((await done("exc")).count).toBe(3);
  });

  it("stops at maxResults and says so", async () => {
    startCodeSearch("s1", query("needle", { maxResults: 2 }), "cap");
    const end = await done("cap");
    expect(end).toMatchObject({ count: 2, truncated: true });
    expect(matches("cap")).toHaveLength(2);
  });

  it("reports an invalid regex", async () => {
    startCodeSearch("s1", query("(", { regex: true }), "bad");
    expect((await done("bad")).error).toMatch(/regex/i);
  });

  it("cancels a running search", async () => {
    const big = Array.from({ length: 2000 }, () => "needle").join("\n");
    for (let i = 0; i < 50; i++) {
      await fs.promises.writeFile(path.join(repo, `src/big${i}.txt`), big);
    }
    startCodeSearch("s1", query("needle", { maxResults: 20_000 }), "c");
    cancelCodeSearch("c");
    const end = await done("c");
    expect(end.cancelled).toBe(true);
    expect(end.count).toBeLessThan(100_000);
  });

  it("refuses a search id already in use", () => {
    startCodeSearch("s1", query("needle"), "dup");
    expect(() => startCodeSearch("s1", query("needle"), "dup")).toThrow(
      /already running/,
    );
  });
});
