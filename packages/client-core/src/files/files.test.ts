import type { CodeSearchMatch } from "@argus/remote-protocol";
import { describe, expect, it } from "vitest";
import { detectCodeLanguage } from "./codeLanguage";
import {
  beginFileSearch,
  detachFileSearch,
  IDLE_FILE_SEARCH,
  matchPreviewParts,
  receiveFileSearchEvent,
  resultBucket,
} from "./fileSearch";
import {
  directoryOf,
  fileNameOf,
  normalizeRelativePath,
  relativeSessionPath,
} from "./sessionFilePaths";

function match(
  relativePath: string,
  line: number,
  extra: Partial<CodeSearchMatch> = {},
): CodeSearchMatch {
  return {
    relativePath,
    line,
    column: 0,
    length: 1,
    preview: "x",
    previewOffset: 0,
    ...extra,
  };
}

describe("session file paths", () => {
  it("normalizes relative paths and refuses ones that leave the worktree", () => {
    expect(normalizeRelativePath("./a/../b.ts")).toBe("b.ts");
    expect(normalizeRelativePath("src//x.ts")).toBe("src/x.ts");
    expect(normalizeRelativePath("../x.ts")).toBeNull();
    expect(normalizeRelativePath(".")).toBeNull();
  });

  it("places an absolute path by the longest file it ends with", () => {
    const files = ["x.ts", "src/x.ts", "src/y.ts"];
    expect(relativeSessionPath("/Users/me/wt/src/x.ts", files)).toBe(
      "src/x.ts",
    );
    expect(relativeSessionPath("~/wt/nope.ts", files)).toBeNull();
    expect(relativeSessionPath("  src/y.ts ", files)).toBe("src/y.ts");
    expect(relativeSessionPath("", files)).toBeNull();
  });

  it("splits a path into its name and directory", () => {
    expect(fileNameOf("a/b/c.ts")).toBe("c.ts");
    expect(directoryOf("a/b/c.ts")).toBe("a/b");
    expect(directoryOf("c.ts")).toBe("");
  });
});

describe("detectCodeLanguage", () => {
  it.each<[string, string | undefined, string | null]>([
    ["src/App.tsx", undefined, "typescript"],
    ["ios/App/AppDelegate.swift", undefined, "swift"],
    ["android/app/build.gradle", undefined, "groovy"],
    ["Dockerfile", undefined, "dockerfile"],
    ["ios/Podfile", undefined, "ruby"],
    ["scripts/run", "#!/usr/bin/env bash", "bash"],
    ["scripts/tool", "#!/usr/bin/env python3", "python"],
    ["LICENSE", undefined, null],
    ["data.bin", undefined, null],
  ])("reads %s as %s", (path, firstLine, language) => {
    expect(detectCodeLanguage(path, firstLine)).toBe(language);
  });
});

describe("file search", () => {
  it("groups matches by file in the order they arrive", () => {
    let state = beginFileSearch("s1");
    state = receiveFileSearchEvent(state, {
      kind: "matches",
      searchId: "s1",
      matches: [match("a.ts", 1), match("b.ts", 4), match("a.ts", 9)],
    }).state;
    expect(
      state.groups.map((g) => [g.path, g.matches.map((m) => m.line)]),
    ).toEqual([
      ["a.ts", [1, 9]],
      ["b.ts", [4]],
    ]);
    expect(state.matchCount).toBe(3);

    const done = receiveFileSearchEvent(state, {
      kind: "done",
      searchId: "s1",
      count: 3,
      truncated: false,
      cancelled: false,
    });
    expect(done.state.phase).toEqual({
      kind: "done",
      count: 3,
      truncated: false,
    });
    expect(done.finished).toEqual({ count: 3, truncated: false });
  });

  it("ignores another search's events", () => {
    const state = beginFileSearch("s2");
    const update = receiveFileSearchEvent(state, {
      kind: "matches",
      searchId: "s1",
      matches: [match("a.ts", 1)],
    });
    expect(update.state).toBe(state);
    expect(
      receiveFileSearchEvent(IDLE_FILE_SEARCH, {
        kind: "done",
        searchId: "s1",
        count: 0,
        truncated: false,
        cancelled: false,
      }).state,
    ).toBe(IDLE_FILE_SEARCH);
  });

  it("fails with ripgrep's complaint and reports nothing for a cancelled one", () => {
    const failed = receiveFileSearchEvent(beginFileSearch("s1"), {
      kind: "done",
      searchId: "s1",
      count: 0,
      truncated: false,
      cancelled: false,
      error: "regex parse error",
    });
    expect(failed.state.phase).toEqual({
      kind: "failed",
      message: "regex parse error",
    });
    expect(failed.finished).toBeUndefined();

    const cancelled = receiveFileSearchEvent(beginFileSearch("s1"), {
      kind: "done",
      searchId: "s1",
      count: 0,
      truncated: false,
      cancelled: true,
    });
    expect(cancelled.finished).toBeUndefined();
  });

  it("keeps what arrived when detached", () => {
    let state = beginFileSearch("s1");
    state = receiveFileSearchEvent(state, {
      kind: "matches",
      searchId: "s1",
      matches: [match("a.ts", 1)],
    }).state;
    const detached = detachFileSearch(state);
    expect(detached.searchId).toBeNull();
    expect(detached.phase).toEqual({
      kind: "done",
      count: 1,
      truncated: false,
    });
  });

  it("buckets counts as the phone does", () => {
    expect([0, 1, 10, 11, 100, 101, 1000, 1001].map(resultBucket)).toEqual([
      "0",
      "1-10",
      "1-10",
      "11-100",
      "11-100",
      "101-1000",
      "101-1000",
      "1000+",
    ]);
  });

  it("splits a preview around the match", () => {
    expect(
      matchPreviewParts(
        match("a.ts", 1, {
          preview: "const needle = 1",
          previewOffset: 4,
          column: 10,
          length: 6,
        }),
      ),
    ).toEqual({ before: "const ", match: "needle", after: " = 1" });
  });
});
