import type { CodeSymbol, CodeSymbolKind } from "@argus/remote-protocol";
import { describe, expect, it } from "vitest";
import { FuzzyFileMatcher, splitMatchedPath } from "./fuzzyFileMatcher";
import { parseQuickOpenQuery } from "./query";
import {
  mergeSymbols,
  type QuickOpenResult,
  rankFileSymbols,
  rankMixed,
  rankSymbols,
} from "./ranker";

// Vectors shared with ArgusCore's FuzzyFileMatcherTests and QuickOpenTests.

const PATHS = [
  "packages/host/src/services/session/watcher.ts",
  "clients/apple/ArgusCore/Sources/ArgusCore/Code/FuzzyFileMatcher.swift",
  "clients/apple/ArgusUI/Sources/ArgusUI/Views/CodeView.swift",
  "app/components/agent/AgentView.tsx",
  "docs/routing.md",
  "README.md",
  "fizz/zoom/m.swift",
];

describe("fuzzyFileMatcher", () => {
  const matcher = new FuzzyFileMatcher(PATHS);

  it("ranks the file name above letters scattered over directories", () => {
    expect(matcher.search("fzm")[0]?.path).toBe(PATHS[1]);
    expect(matcher.search("codeview")[0]?.path).toBe(PATHS[2]);
    expect(matcher.search("readme")[0]?.path).toBe("README.md");
  });

  it("ranks word boundaries and runs above scattered letters", () => {
    const ranked = new FuzzyFileMatcher([
      "src/xaxgxexnxt.ts",
      "src/AgentView.tsx",
      "src/agent.ts",
    ])
      .search("agent")
      .map((m) => m.path);
    expect(ranked.at(-1)).toBe("src/xaxgxexnxt.ts");
    expect(ranked[0]).toBe("src/agent.ts");
  });

  it("drops non-matches and matches case-insensitively", () => {
    expect(matcher.search("zzzq")).toEqual([]);
    expect(matcher.search("WATCHER").map((m) => m.path)).toEqual([PATHS[0]]);
    expect(matcher.search("agent view")[0]?.path).toBe(PATHS[3]);
  });

  it("points indices at the matched characters", () => {
    const match = FuzzyFileMatcher.match("cv", "Views/CodeView.swift");
    expect(match?.indices).toEqual([6, 10]);
  });

  it("ranks changed files first, and lists them first for an empty query", () => {
    const boost = new Set(["docs/routing.md"]);
    const results = matcher.search("md", { boost });
    expect(results[0]?.path).toBe("docs/routing.md");
    expect(results[0]?.isBoosted).toBe(true);
    const empty = matcher.search("", { boost, limit: 3 });
    expect(empty.map((m) => m.path)).toEqual([
      "docs/routing.md",
      PATHS[0],
      PATHS[1],
    ]);
  });

  it("searches 200k paths quickly", () => {
    const dirs = [
      "packages/host/src",
      "clients/apple/ArgusUI/Sources",
      "app/components/agent",
      "node_modules/lodash/fp",
    ];
    const many = Array.from(
      { length: 200_000 },
      (_, i) =>
        `${dirs[i % dirs.length]}/module${Math.floor(i / 7)}/File${i}View.swift`,
    );
    const big = new FuzzyFileMatcher(many);
    const started = performance.now();
    expect(big.search("file1999view").length).toBeGreaterThan(0);
    expect(big.search("fv")).toHaveLength(50);
    expect(performance.now() - started).toBeLessThan(4000);
  });
});

describe("splitMatchedPath", () => {
  it("splits offsets between the file name and its directory", () => {
    expect(splitMatchedPath("Views/CodeView.swift", [0, 6, 10])).toEqual({
      name: "CodeView.swift",
      nameIndices: [0, 4],
      directory: "Views",
      directoryIndices: [0],
    });
    expect(splitMatchedPath("README.md", [0])).toEqual({
      name: "README.md",
      nameIndices: [0],
      directory: "",
      directoryIndices: [],
    });
  });
});

describe("parseQuickOpenQuery", () => {
  it("reads plain text as the palette's mode", () => {
    expect(parseQuickOpenQuery("store", "files")).toEqual({
      kind: "files",
      text: "store",
    });
    expect(parseQuickOpenQuery("store", "mixed")).toEqual({
      kind: "mixed",
      text: "store",
    });
    expect(parseQuickOpenQuery("", "files")).toEqual({
      kind: "files",
      text: "",
    });
  });

  it("reads @ and @: as the file's symbols, # as the workspace's", () => {
    expect(parseQuickOpenQuery("@load ", "files")).toEqual({
      kind: "fileSymbols",
      text: "load",
      grouped: false,
    });
    expect(parseQuickOpenQuery("@:", "files")).toEqual({
      kind: "fileSymbols",
      text: "",
      grouped: true,
    });
    expect(parseQuickOpenQuery("@:ld", "mixed")).toEqual({
      kind: "fileSymbols",
      text: "ld",
      grouped: true,
    });
    expect(parseQuickOpenQuery("# Store", "files")).toEqual({
      kind: "workspaceSymbols",
      text: "Store",
    });
    expect(parseQuickOpenQuery("#", "files")).toEqual({
      kind: "workspaceSymbols",
      text: "",
    });
  });

  it.each<[string, number | null, number | null]>([
    [":42", 42, null],
    [":42:7", 42, 7],
    [":42,7", 42, 7],
    [":", null, null],
    [":x", null, null],
    [":0", null, null],
  ])("reads %s as a line and column", (text, line, column) => {
    expect(parseQuickOpenQuery(text, "files")).toEqual({
      kind: "line",
      line,
      column,
    });
  });
});

function sym(
  name: string,
  kind: CodeSymbolKind = "method",
  {
    path = "a.swift",
    line = 1,
    container,
  }: { path?: string; line?: number; container?: string } = {},
): CodeSymbol {
  return { name, kind, container, relativePath: path, line, column: 0 };
}

function describeResults(results: QuickOpenResult[]): string[] {
  return results.map((r) =>
    r.kind === "file"
      ? `file ${r.path}${r.boosted ? " *" : ""}`
      : `${r.symbol.kind} ${r.symbol.name}${r.boosted ? " *" : ""}`,
  );
}

describe("quick open ranking", () => {
  it("lists a definition both sources know once, as the language server has it", () => {
    const merged = mergeSymbols(
      [
        sym("load", "function", { line: 3 }),
        sym("save", "method", { line: 9 }),
      ],
      [sym("load", "method", { line: 3, container: "Store" })],
    );
    expect(merged.map((s) => s.name)).toEqual(["load", "save"]);
    expect(merged[0].kind).toBe("method");
    expect(merged[0].container).toBe("Store");
  });

  it("puts exact names over prefixes over fuzzy matches, types winning a tie", () => {
    const ranked = rankSymbols(
      "store",
      [
        sym("restore"),
        sym("storeItems"),
        sym("store"),
        sym("Store", "class"),
        sym("sxtxoxrxe"),
      ],
      new Set(),
    );
    expect(describeResults(ranked)).toEqual([
      "class Store",
      "method store",
      "method storeItems",
      "method restore",
      "method sxtxoxrxe",
    ]);
  });

  it("mixes files and symbols by the same tiers, changed files first within one", () => {
    const ranked = rankMixed(
      "store",
      [
        "Sources/Store.swift",
        "Sources/StoreView.swift",
        "docs/restore.md",
        "src/x/store-utils.ts",
      ],
      [
        sym("Store", "class", { path: "Sources/Store.swift" }),
        sym("storeHelper", "function", { path: "lib.ts" }),
      ],
      new Set(["src/x/store-utils.ts"]),
    );
    expect(describeResults(ranked)).toEqual([
      "class Store",
      "file Sources/Store.swift",
      "file src/x/store-utils.ts *",
      "function storeHelper",
      "file Sources/StoreView.swift",
      "file docs/restore.md",
    ]);
  });

  it("lists a file's symbols in order, by kind with @:, fuzzy once typed", () => {
    const symbols = [
      sym("load", "method", { line: 3 }),
      sym("Store", "class", { line: 1 }),
      sym("count", "property", { line: 2 }),
    ];
    expect(describeResults(rankFileSymbols("", symbols, false))).toEqual([
      "method load",
      "class Store",
      "property count",
    ]);
    expect(describeResults(rankFileSymbols("", symbols, true))).toEqual([
      "class Store",
      "method load",
      "property count",
    ]);
    expect(describeResults(rankFileSymbols("cnt", symbols, false))).toEqual([
      "property count",
    ]);
  });
});
