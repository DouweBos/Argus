import { describe, expect, it } from "vitest";
import { parseConflictingFiles } from "./merge";

describe("parseConflictingFiles", () => {
  it("returns empty array for clean merge output", () => {
    expect(parseConflictingFiles("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2\n")).toEqual([]);
  });

  it("parses CONFLICT lines with 'Merge conflict in'", () => {
    const stdout = [
      "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      "CONFLICT (content): Merge conflict in src/main.ts",
      "CONFLICT (content): Merge conflict in src/utils.ts",
    ].join("\n");

    const result = parseConflictingFiles(stdout);
    expect(result).toEqual(["src/main.ts", "src/utils.ts"]);
  });

  it("handles lowercase 'merge conflict in'", () => {
    const stdout = [
      "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      "CONFLICT (content): merge conflict in README.md",
    ].join("\n");

    expect(parseConflictingFiles(stdout)).toEqual(["README.md"]);
  });

  it("returns empty for output with no tree hash prefix", () => {
    // If the first line is not a 40-char hex hash, nothing should parse
    const stdout = "some random output\nCONFLICT: Merge conflict in file.ts";
    expect(parseConflictingFiles(stdout)).toEqual([]);
  });

  it("skips non-CONFLICT lines after tree hash", () => {
    const stdout = [
      "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      "Auto-merging src/main.ts",
      "CONFLICT (content): Merge conflict in src/main.ts",
      "Automatic merge went well",
    ].join("\n");

    expect(parseConflictingFiles(stdout)).toEqual(["src/main.ts"]);
  });

  it("handles empty string", () => {
    expect(parseConflictingFiles("")).toEqual([]);
  });

  it("handles CONFLICT without file path", () => {
    const stdout = [
      "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      "CONFLICT (modify/delete): something happened",
    ].join("\n");

    // No "Merge conflict in" marker, so no file extracted
    expect(parseConflictingFiles(stdout)).toEqual([]);
  });
});
