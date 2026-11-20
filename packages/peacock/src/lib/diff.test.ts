import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDiff } from "./diff";

// Shared with the Swift and Kotlin parsers, which assert against the same file.
const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../../../clients/apple/ArgusKit/Tests/ArgusKitTests/Fixtures/diff-sample.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { files: unknown[]; raw: string };

function shape(raw: string) {
  return parseDiff(raw).map((f) => ({
    oldPath: f.oldPath,
    newPath: f.newPath,
    status: f.status,
    hunks: f.hunks.map((h) => ({
      header: h.header,
      lines: h.lines.map((l) => ({
        type: l.type,
        content: l.content,
        oldNumber: l.oldNum ?? null,
        newNumber: l.newNum ?? null,
      })),
    })),
  }));
}

describe("parseDiff", () => {
  it("matches the shared fixture the native clients parse", () => {
    expect(shape(fixture.raw)).toEqual(fixture.files);
  });

  it("ends every hunk on its last real line, not the diff's trailing newline", () => {
    const hunks = parseDiff(fixture.raw).flatMap((f) => f.hunks);
    const phantom = hunks.filter((h) => {
      const last = h.lines.at(-1);

      return last?.type === "context" && last.content === "";
    });
    expect(phantom).toEqual([]);
    expect(hunks.filter((h) => h.patch.endsWith("\n\n"))).toEqual([]);
  });

  it("keeps blank lines inside a hunk, bare or space-prefixed", () => {
    const blank = parseDiff(fixture.raw).find((f) => f.newPath === "blank.txt");
    const lines = blank?.hunks[0].lines ?? [];
    expect(lines.map((l) => l.type)).toEqual([
      "context",
      "remove",
      "context",
      "context",
      "remove",
      "context",
      "add",
      "context",
      "add",
    ]);
    expect(lines.at(-1)).toEqual({ type: "add", content: "", newNum: 7 });
  });

  it("counts an omitted hunk length as one line", () => {
    const raw =
      "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n\ndiff --git a/y b/y\n";
    expect(parseDiff(raw)[0].hunks[0].lines.map((l) => l.type)).toEqual([
      "remove",
      "add",
    ]);
  });
});
