import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { automationMemoryDir } from "../paths";
import { memorySection } from "../runPrompt";
import {
  deleteAllMemories,
  deleteMemory,
  listMemories,
  parseMemory,
  readMemoryIndex,
  saveMemory,
  serializeMemory,
} from "./store";

let home: string;
let previousHome: string | undefined;

const MEMORY = {
  name: "merge-flow",
  description: "Where session merges are implemented",
  type: "project" as const,
  body: "`packages/host/src/services/session/merge.ts`.",
};

describe("automation memory store", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-memory-"));
    process.env.ARGUS_HOME = home;
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env.ARGUS_HOME;
    } else {
      process.env.ARGUS_HOME = previousHome;
    }
    fs.rmSync(home, { force: true, recursive: true });
  });

  it("round-trips Claude's frontmatter", () => {
    expect(parseMemory(serializeMemory(MEMORY))).toEqual(MEMORY);
  });

  it("saves, indexes and deletes a memory", () => {
    saveMemory("a1", MEMORY);

    expect(listMemories("a1")).toMatchObject([MEMORY]);
    expect(readMemoryIndex("a1")).toBe(
      "- [merge-flow](merge-flow.md) — Where session merges are implemented",
    );

    deleteMemory("a1", "merge-flow");
    expect(listMemories("a1")).toEqual([]);
    expect(readMemoryIndex("a1")).toBeNull();
  });

  it("renames the file and the index entry", () => {
    saveMemory("a1", MEMORY);
    saveMemory("a1", {
      ...MEMORY,
      name: "merges",
      previous_name: "merge-flow",
    });

    expect(listMemories("a1").map((m) => m.name)).toEqual(["merges"]);
    expect(readMemoryIndex("a1")).toContain("[merges](merges.md)");
    expect(
      fs.existsSync(path.join(automationMemoryDir("a1"), "merge-flow.md")),
    ).toBe(false);
  });

  it("refuses a rename onto an existing memory", () => {
    saveMemory("a1", MEMORY);
    saveMemory("a1", { ...MEMORY, name: "other" });

    expect(() =>
      saveMemory("a1", {
        ...MEMORY,
        name: "other",
        previous_name: "merge-flow",
      }),
    ).toThrow();
  });

  it("rejects names that aren't slugs, including path traversal", () => {
    for (const name of ["../escape", "Upper", "a/b", "", "MEMORY"]) {
      expect(() => saveMemory("a1", { ...MEMORY, name })).toThrow();
    }
    expect(() => deleteMemory("a1", "../../automations")).toThrow();
  });

  it("rejects a multi-line description and an empty body", () => {
    expect(() =>
      saveMemory("a1", { ...MEMORY, description: "a\nb" }),
    ).toThrow();
    expect(() => saveMemory("a1", { ...MEMORY, body: "  " })).toThrow();
  });

  it("skips a file it can't parse", () => {
    saveMemory("a1", MEMORY);
    fs.writeFileSync(
      path.join(automationMemoryDir("a1"), "junk.md"),
      "no frontmatter",
    );

    expect(listMemories("a1").map((m) => m.name)).toEqual(["merge-flow"]);
  });

  it("removes the whole directory with the automation", () => {
    saveMemory("a1", MEMORY);
    deleteAllMemories("a1");

    expect(fs.existsSync(automationMemoryDir("a1"))).toBe(false);
  });

  it("puts the index and the directory in the run prompt", () => {
    expect(memorySection("a1").join("\n")).toContain("No memories yet.");

    saveMemory("a1", MEMORY);
    const section = memorySection("a1").join("\n");
    expect(section).toContain(automationMemoryDir("a1"));
    expect(section).toContain("[merge-flow](merge-flow.md)");
  });
});
