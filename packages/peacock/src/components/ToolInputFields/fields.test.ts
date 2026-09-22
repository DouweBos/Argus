import { describe, expect, it } from "vitest";
import { toolInputFields, toolInputText } from "./fields";

describe("tool input fields", () => {
  it("flattens nested objects and arrays into readable paths", () => {
    const fields = toolInputFields({
      file_path: "/tmp/a.txt",
      edits: [{ old_string: "a", new_string: "b" }],
    });

    expect(fields.map((f) => f.label)).toEqual([
      "edits 1 · new_string",
      "edits 1 · old_string",
      "file_path",
    ]);
    expect(fields.map((f) => f.value)).toEqual(["b", "a", "/tmp/a.txt"]);
  });

  it("renders scalars as text and empty containers as none", () => {
    const byLabel = Object.fromEntries(
      toolInputFields({
        count: 3,
        enabled: true,
        missing: null,
        paths: [],
        options: {},
      }).map((f) => [f.label, f.value]),
    );

    expect(byLabel).toEqual({
      count: "3",
      enabled: "true",
      missing: "none",
      paths: "none",
      options: "none",
    });
  });

  it("marks long and multi-line values for their own block", () => {
    const byLabel = Object.fromEntries(
      toolInputFields({
        short: "ok",
        wrapped: "line one\nline two",
        long: "x".repeat(60),
      }).map((f) => [f.label, f.isLong]),
    );

    expect(byLabel).toEqual({ short: false, wrapped: true, long: true });
  });

  it("copies as the same labelled lines it shows", () => {
    expect(toolInputText({ pattern: "TODO", path: "src" })).toBe(
      "path: src\npattern: TODO",
    );
  });
});
