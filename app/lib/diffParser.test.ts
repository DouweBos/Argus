import { describe, expect, it } from "vitest";
import {
  buildPartialPatch,
  gitIndexPath,
  mergeStaged,
  parseDiff,
} from "./diffParser";

const SIMPLE_DIFF = `diff --git a/src/main.ts b/src/main.ts
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,3 +1,4 @@
 import { app } from "electron";
+import path from "path";

 app.whenReady().then(() => {
`;

const NEW_FILE_DIFF = `diff --git a/README.md b/README.md
new file mode 100644
--- /dev/null
+++ b/README.md
@@ -0,0 +1,3 @@
+# Hello
+
+This is new.
`;

const DELETED_FILE_DIFF = `diff --git a/old.txt b/old.txt
deleted file mode 100644
--- a/old.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-line one
-line two
`;

const MULTI_HUNK_DIFF = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
 first
+added-top
 second
 third
@@ -10,3 +11,2 @@
 ten
-removed
 twelve
`;

/** Git omits ---/+++ for binary files; paths only appear on diff --git / Binary lines. */
const BINARY_DIFF = `diff --git a/assets/logo.png b/assets/logo.png
index 1111111..2222222 100644
Binary files a/assets/logo.png and b/assets/logo.png differ
`;

const BINARY_ADD_DIFF = `diff --git a/new.bin b/new.bin
new file mode 100644
index 0000000..3333333
Binary files /dev/null and b/new.bin differ
`;

/** Some renames omit ---/+++ when there is no hunk; paths only appear on rename lines. */
const RENAME_HEADER_ONLY = `diff --git a/oldname.txt b/newname.txt
similarity index 100%
rename from oldname.txt
rename to newname.txt
`;

describe("parseDiff", () => {
  it("parses a simple modification", () => {
    const files = parseDiff(SIMPLE_DIFF);
    expect(files).toHaveLength(1);
    expect(files[0].status).toBe("M");
    expect(files[0].oldPath).toBe("src/main.ts");
    expect(files[0].newPath).toBe("src/main.ts");
    expect(files[0].hunks).toHaveLength(1);
    expect(files[0].staged).toBe("none");
  });

  it("identifies added lines", () => {
    const files = parseDiff(SIMPLE_DIFF);
    const addLines = files[0].hunks[0].lines.filter((l) => l.type === "add");
    expect(addLines).toHaveLength(1);
    expect(addLines[0].content).toBe('import path from "path";');
  });

  it("detects new files", () => {
    const files = parseDiff(NEW_FILE_DIFF);
    expect(files).toHaveLength(1);
    expect(files[0].status).toBe("A");
    expect(files[0].oldPath).toBe("");
    expect(files[0].newPath).toBe("README.md");
  });

  it("detects deleted files", () => {
    const files = parseDiff(DELETED_FILE_DIFF);
    expect(files).toHaveLength(1);
    expect(files[0].status).toBe("D");
    expect(files[0].newPath).toBe("");
  });

  it("parses multiple hunks", () => {
    const files = parseDiff(MULTI_HUNK_DIFF);
    expect(files).toHaveLength(1);
    expect(files[0].hunks).toHaveLength(2);
    expect(files[0].hunks[0].oldStart).toBe(1);
    expect(files[0].hunks[1].oldStart).toBe(10);
  });

  it("parses multiple files", () => {
    const combined = SIMPLE_DIFF + NEW_FILE_DIFF;
    const files = parseDiff(combined);
    expect(files).toHaveLength(2);
    expect(files[0].newPath).toBe("src/main.ts");
    expect(files[1].newPath).toBe("README.md");
  });

  it("returns empty array for empty input", () => {
    expect(parseDiff("")).toEqual([]);
  });

  it("assigns correct line numbers", () => {
    const files = parseDiff(SIMPLE_DIFF);
    const lines = files[0].hunks[0].lines;
    // First context line: old=1, new=1
    expect(lines[0].type).toBe("context");
    expect(lines[0].oldNum).toBe(1);
    expect(lines[0].newNum).toBe(1);
    // Added line: new=2, no oldNum
    expect(lines[1].type).toBe("add");
    expect(lines[1].newNum).toBe(2);
    expect(lines[1].oldNum).toBeUndefined();
  });

  it("generates per-hunk patches", () => {
    const files = parseDiff(MULTI_HUNK_DIFF);
    const patch = files[0].hunks[0].patch;
    expect(patch).toContain("diff --git");
    expect(patch).toContain("@@ -1,3 +1,4 @@");
    expect(patch).toContain("+added-top");
  });

  it("parses binary diffs without ---/+++ lines", () => {
    const files = parseDiff(BINARY_DIFF);
    expect(files).toHaveLength(1);
    expect(files[0].oldPath).toBe("assets/logo.png");
    expect(files[0].newPath).toBe("assets/logo.png");
    expect(files[0].status).toBe("M");
    expect(files[0].hunks).toHaveLength(0);
  });

  it("parses new binary files (diff --git + Binary files /dev/null)", () => {
    const files = parseDiff(BINARY_ADD_DIFF);
    expect(files).toHaveLength(1);
    expect(files[0].oldPath).toBe("new.bin");
    expect(files[0].newPath).toBe("new.bin");
    expect(files[0].status).toBe("M");
  });

  it("parses rename metadata when ---/+++ are missing", () => {
    const files = parseDiff(RENAME_HEADER_ONLY);
    expect(files).toHaveLength(1);
    expect(files[0].oldPath).toBe("oldname.txt");
    expect(files[0].newPath).toBe("newname.txt");
    expect(files[0].status).toBe("R");
    expect(gitIndexPath(files[0])).toBe("newname.txt");
  });
});

describe("mergeStaged", () => {
  it("marks all lines staged when full diff is staged", () => {
    const full = parseDiff(SIMPLE_DIFF);
    const merged = mergeStaged(full, SIMPLE_DIFF);
    expect(merged[0].staged).toBe("full");
  });

  it("marks none when nothing is staged", () => {
    const full = parseDiff(SIMPLE_DIFF);
    const merged = mergeStaged(full, "");
    expect(merged[0].staged).toBe("none");
  });

  it("marks partial when some hunks are staged", () => {
    // Stage only the first hunk of a multi-hunk diff
    const full = parseDiff(MULTI_HUNK_DIFF);
    const firstHunkOnly = full[0].hunks[0].patch;
    const merged = mergeStaged(full, firstHunkOnly);
    expect(merged[0].staged).toBe("partial");
  });

  /** `git diff --cached` after `git add newname` only — index has an add, not a rename record yet. */
  const RENAME_STAGED_AS_ADD = `diff --git a/newname.txt b/newname.txt
new file mode 100644
--- /dev/null
+++ b/newname.txt
@@ -0,0 +1 @@
+hello
`;

  it("treats pure rename (no @@ hunk in HEAD) as fully staged when cached matches", () => {
    const full = parseDiff(RENAME_HEADER_ONLY);
    const merged = mergeStaged(full, RENAME_HEADER_ONLY);
    expect(merged[0].staged).toBe("full");
  });

  it("marks partial when rename has no hunk in HEAD but the new path is staged as added first", () => {
    const full = parseDiff(RENAME_HEADER_ONLY);
    const merged = mergeStaged(full, RENAME_STAGED_AS_ADD);
    expect(merged[0].staged).toBe("partial");
  });

  it("marks binary modification fully staged when cached matches without hunks", () => {
    const full = parseDiff(BINARY_DIFF);
    const merged = mergeStaged(full, BINARY_DIFF);
    expect(merged[0].staged).toBe("full");
  });
});

describe("buildPartialPatch", () => {
  it("includes only selected add lines", () => {
    const files = parseDiff(SIMPLE_DIFF);
    const file = files[0];
    const hunk = file.hunks[0];
    // Select only the added line (index 1)
    const patch = buildPartialPatch(file, hunk, new Set([1]));
    expect(patch).toContain("+import path");
  });

  it("converts unselected removes to context", () => {
    const files = parseDiff(DELETED_FILE_DIFF);
    const file = files[0];
    const hunk = file.hunks[0];
    // Select nothing — all removes become context
    const patch = buildPartialPatch(file, hunk, new Set());
    expect(patch).not.toContain("-line one");
    expect(patch).toContain(" line one");
  });

  it("omits unselected adds entirely", () => {
    const files = parseDiff(SIMPLE_DIFF);
    const file = files[0];
    const hunk = file.hunks[0];
    // Select nothing
    const patch = buildPartialPatch(file, hunk, new Set());
    expect(patch).not.toContain("import path");
  });

  it("produces correct hunk header counts", () => {
    const files = parseDiff(SIMPLE_DIFF);
    const file = files[0];
    const hunk = file.hunks[0];
    // Select the add line
    const patch = buildPartialPatch(file, hunk, new Set([1]));
    // Should have @@ -1,3 +1,4 @@ (3 old lines, 4 new lines)
    expect(patch).toMatch(/@@ -1,\d+ \+1,\d+ @@/);
  });
});
