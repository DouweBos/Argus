import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { automationMemoryDir, memoryDirFor } from "../paths";
import { capIndex, memorySection } from "../runPrompt";
import {
  deleteAllMemories,
  deleteMemory,
  listMemories,
  parseMemory,
  readMemoryIndex,
  saveMemory,
  serializeMemory,
} from "./store";

const A1 = { kind: "automation" as const, id: "a1" };

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
    saveMemory(A1, MEMORY);

    expect(listMemories(A1)).toMatchObject([MEMORY]);
    expect(readMemoryIndex(A1)).toBe(
      "- [merge-flow](merge-flow.md) — Where session merges are implemented",
    );

    deleteMemory(A1, "merge-flow");
    expect(listMemories(A1)).toEqual([]);
    expect(readMemoryIndex(A1)).toBeNull();
  });

  it("renames the file and the index entry", () => {
    saveMemory(A1, MEMORY);
    saveMemory(A1, {
      ...MEMORY,
      name: "merges",
      previous_name: "merge-flow",
    });

    expect(listMemories(A1).map((m) => m.name)).toEqual(["merges"]);
    expect(readMemoryIndex(A1)).toContain("[merges](merges.md)");
    expect(
      fs.existsSync(path.join(automationMemoryDir("a1"), "merge-flow.md")),
    ).toBe(false);
  });

  it("refuses a rename onto an existing memory", () => {
    saveMemory(A1, MEMORY);
    saveMemory(A1, { ...MEMORY, name: "other" });

    expect(() =>
      saveMemory(A1, {
        ...MEMORY,
        name: "other",
        previous_name: "merge-flow",
      }),
    ).toThrow();
  });

  it("rejects names that aren't slugs, including path traversal", () => {
    for (const name of ["../escape", "Upper", "a/b", "", "MEMORY"]) {
      expect(() => saveMemory(A1, { ...MEMORY, name })).toThrow();
    }
    expect(() => deleteMemory(A1, "../../automations")).toThrow();
  });

  it("rejects a multi-line description and an empty body", () => {
    expect(() => saveMemory(A1, { ...MEMORY, description: "a\nb" })).toThrow();
    expect(() => saveMemory(A1, { ...MEMORY, body: "  " })).toThrow();
  });

  it("skips a file it can't parse", () => {
    saveMemory(A1, MEMORY);
    fs.writeFileSync(
      path.join(automationMemoryDir("a1"), "junk.md"),
      "no frontmatter",
    );

    expect(listMemories(A1).map((m) => m.name)).toEqual(["merge-flow"]);
  });

  it("removes the whole directory with the automation", () => {
    saveMemory(A1, MEMORY);
    deleteAllMemories(A1);

    expect(fs.existsSync(automationMemoryDir("a1"))).toBe(false);
  });

  it("puts the index and the directory in the run prompt", () => {
    expect(memorySection(A1).join("\n")).toContain("No memories yet.");

    saveMemory(A1, MEMORY);
    const section = memorySection(A1).join("\n");
    expect(section).toContain(automationMemoryDir("a1"));
    expect(section).toContain("[merge-flow](merge-flow.md)");
  });

  it("keeps a teammate's memory in its own home", () => {
    const owner = { kind: "teammate" as const, id: "t1" };
    saveMemory(owner, MEMORY);

    expect(fs.existsSync(path.join(memoryDirFor(owner), "merge-flow.md"))).toBe(
      true,
    );
    expect(listMemories(A1)).toEqual([]);
    expect(memorySection(owner).join("\n")).toContain(
      "You keep a memory across runs and conversations",
    );
  });

  it("cuts an oversized index at a line", () => {
    const line = `- [x](x.md) — ${"d".repeat(180)}`;
    const capped = capIndex(Array(100).fill(line).join("\n"));

    expect(capped.length).toBeLessThan(12_200);
    expect(capped).toContain("The index is cut off here");
    expect(capped.split("\n")[0]).toBe(line);
  });
});
