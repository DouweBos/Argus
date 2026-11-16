import { describe, expect, it } from "vitest";
import { conflictFixPrompt, startConflictFix } from "./conflictFix";

describe("conflictFixPrompt", () => {
  it("names the branch, the base and every file, and leaves the merge to the user", () => {
    const prompt = conflictFixPrompt("feat/x", "main", ["a.swift", "b.ts"]);
    expect(prompt).toContain("`feat/x` can't merge into `main`");
    expect(prompt).toContain("- `a.swift`\n- `b.ts`");
    expect(prompt).toContain("git rebase main");
    expect(prompt).toContain("Don't merge into `main` and don't push");
  });
});

describe("startConflictFix", () => {
  it("refuses a session it doesn't know", async () => {
    await expect(startConflictFix("missing")).rejects.toBe(
      "This session has no branch to rebase.",
    );
  });
});
