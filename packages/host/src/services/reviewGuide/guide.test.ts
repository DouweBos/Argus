import { describe, expect, it } from "vitest";
import { guidePrompt, normalizeGuide, parsePatch } from "./guide";

const PATCH = `diff --git a/src/a.ts b/src/a.ts
index 1..2 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
diff --git a/old.txt b/old.txt
deleted file mode 100644
--- a/old.txt
+++ /dev/null
@@ -1 +0,0 @@
-gone
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -1 +1 @@
-x
+y
`;

const meta = { headSha: "abc", baseRef: "main", now: new Date(0) };

describe("parsePatch", () => {
  it("names files, deleted ones by their old path, with counts", () => {
    expect(
      parsePatch(PATCH).map((f) => [
        f.path,
        f.deleted,
        f.additions,
        f.deletions,
      ]),
    ).toEqual([
      ["src/a.ts", false, 2, 1],
      ["old.txt", true, 0, 1],
      ["pnpm-lock.yaml", false, 1, 1],
    ]);
  });
});

describe("normalizeGuide", () => {
  const files = parsePatch(PATCH);

  it("covers every file once, with mechanical stops last", () => {
    const reply = JSON.stringify({
      overview: "Changes b.",
      stops: [
        { title: "Lockfile", mechanical: true, paths: ["pnpm-lock.yaml"] },
        {
          title: "The constant",
          summary: "b is 3 now.",
          paths: ["src/a.ts", "nope.ts"],
          ranges: [
            { path: "src/a.ts", side: "new", start: 2, end: 3 },
            { path: "nope.ts", start: 1 },
          ],
          look_closely: [
            { note: "Is 3 right?", path: "src/a.ts", line: 2 },
            { note: "" },
          ],
        },
        { title: "Again", paths: ["src/a.ts"] },
      ],
    });
    const guide = normalizeGuide(
      `Here you go:\n\`\`\`json\n${reply}\n\`\`\``,
      files,
      meta,
    );
    expect(
      guide?.stops.map((s) => [s.id, s.title, s.mechanical, s.paths]),
    ).toEqual([
      ["s1", "The constant", false, ["src/a.ts"]],
      ["s2", "Lockfile", true, ["pnpm-lock.yaml"]],
      ["s3", "Everything else", true, ["old.txt"]],
    ]);
    expect(guide?.stops[0].ranges).toEqual([
      { path: "src/a.ts", side: "new", start: 2, end: 3 },
    ]);
    expect(guide?.stops[0].look_closely).toEqual([
      { note: "Is 3 right?", path: "src/a.ts", line: 2 },
    ]);
  });

  it("puts a deleted file's ranges on the old side", () => {
    const reply = JSON.stringify({
      stops: [{ title: "Gone", ranges: [{ path: "old.txt", start: 1 }] }],
    });
    expect(normalizeGuide(reply, files, meta)?.stops[0].ranges).toEqual([
      { path: "old.txt", side: "old", start: 1, end: 1 },
    ]);
  });

  it("is null for a reply that isn't a guide", () => {
    expect(normalizeGuide("I can't do that.", files, meta)).toBeNull();
    expect(normalizeGuide('{"stops": []}', files, meta)).toBeNull();
  });
});

describe("guidePrompt", () => {
  it("leaves out diffs over the budget but still lists them", () => {
    const huge = `diff --git a/big.json b/big.json\n--- a/big.json\n+++ b/big.json\n@@ -0,0 +1 @@\n+${"x".repeat(200_000)}\n`;
    const prompt = guidePrompt(parsePatch(PATCH + huge), {
      subject: "the branch",
      baseRef: "main",
    });
    expect(prompt).toContain("too large to include");
    expect(prompt).toContain("- big.json");
    expect(prompt).toContain("+const c = 4;");
  });
});
