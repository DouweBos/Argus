import { describe, expect, it } from "vitest";
import { parseConflictingFiles } from "./merge";

describe("parseConflictingFiles", () => {
  it("returns empty array for clean merge output", () => {
    expect(
      parseConflictingFiles("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2\n"),
    ).toEqual([]);
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

  it("parses stage entries from merge-tree --write-tree output", () => {
    // Real-world output: tree OID, then stage 1/2/3 lines per conflicted
    // file, then blank line, then informational messages.
    const stdout = [
      "d99e889788b5ea1773f7c96ebd197d5583eebdaa",
      "100644 880e43bde40593923806a6aa14ca79650d006fdc 1\tapp/lib/ipc.ts",
      "100644 d4bddb25ea360e4791b76088d33b533ceab9190f 2\tapp/lib/ipc.ts",
      "100644 1694bb85272362f98f36d280afae48d9c7201118 3\tapp/lib/ipc.ts",
      "100644 d69db0a0371d075318866427c0b4797aa45e77ff 1\telectron/ipc.ts",
      "100644 788f435c3d7e54dce59a842497546fad7886c3d4 2\telectron/ipc.ts",
      "100644 3f90c6b29182f428b2af9334f27be24ea6177ef3 3\telectron/ipc.ts",
      "",
      "Auto-merging app/lib/ipc.ts",
      "CONFLICT (content): Merge conflict in app/lib/ipc.ts",
    ].join("\n");

    const result = parseConflictingFiles(stdout);
    // Stage lines produce duplicates (stages 1/2/3) — dedup happens upstream.
    // Parser should still include the paths.
    expect(result).toContain("app/lib/ipc.ts");
    expect(result).toContain("electron/ipc.ts");
    // Must not include a diff marker as a "file path".
    expect(result.some((f) => f.startsWith("+<<<<<<<"))).toBe(false);
  });

  it("ignores stage 0 (clean) entries", () => {
    const stdout = [
      "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      "100644 abcdef1234567890abcdef1234567890abcdef12 0\tclean.ts",
    ].join("\n");

    expect(parseConflictingFiles(stdout)).toEqual([]);
  });
});
