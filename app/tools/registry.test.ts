import { describe, expect, it } from "vitest";
import { getTool, TOOLS } from "./registry";
import { TOOL_IDS } from "./types";

describe("tool registry", () => {
  it("registers exactly the tools listed in TOOL_IDS", () => {
    const registered = TOOLS.map((t) => t.id).sort();
    const expected = [...TOOL_IDS].sort();
    expect(registered).toEqual(expected);
  });

  it("has unique tool ids", () => {
    const ids = TOOLS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("references only known tools in `requires`", () => {
    const ids = new Set(TOOLS.map((t) => t.id));
    for (const tool of TOOLS) {
      for (const dep of tool.requires ?? []) {
        expect(ids.has(dep)).toBe(true);
      }
    }
  });

  it("has no `requires` cycles", () => {
    const visit = (id: string, stack: Set<string>): void => {
      if (stack.has(id)) {
        throw new Error(`requires cycle through ${id}`);
      }
      const tool = TOOLS.find((t) => t.id === id);
      if (!tool?.requires) {
        return;
      }
      const next = new Set(stack);
      next.add(id);
      for (const dep of tool.requires) {
        visit(dep, next);
      }
    };
    expect(() => TOOLS.forEach((t) => visit(t.id, new Set()))).not.toThrow();
  });

  it("contributed ipc groups match the tool id", () => {
    const mismatches = TOOLS.flatMap((tool) => {
      const group = tool.contributes?.ipcGroup;

      return group !== undefined && group !== tool.id
        ? [`${tool.id} → ${group}`]
        : [];
    });
    expect(mismatches).toEqual([]);
  });

  it("getTool throws on unknown id", () => {
    // @ts-expect-error -- intentional bad id for the test
    expect(() => getTool("nope")).toThrow(/Unknown tool id/);
  });
});
