import { describe, expect, it } from "vitest";
import { getPlugin, PLUGINS } from "./registry";
import { PLUGIN_IDS } from "./types";

describe("plugin registry", () => {
  it("registers exactly the plugins listed in PLUGIN_IDS", () => {
    const registered = PLUGINS.map((p) => p.id).sort();
    const expected = [...PLUGIN_IDS].sort();
    expect(registered).toEqual(expected);
  });

  it("has unique plugin ids", () => {
    const ids = PLUGINS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("references only known plugins in `requires`", () => {
    const ids = new Set(PLUGINS.map((p) => p.id));
    for (const plugin of PLUGINS) {
      for (const dep of plugin.requires ?? []) {
        expect(ids.has(dep)).toBe(true);
      }
    }
  });

  it("has no `requires` cycles", () => {
    const visit = (id: string, stack: Set<string>): void => {
      if (stack.has(id)) {
        throw new Error(`requires cycle through ${id}`);
      }
      const plugin = PLUGINS.find((p) => p.id === id);
      if (!plugin?.requires) {
        return;
      }
      const next = new Set(stack);
      next.add(id);
      for (const dep of plugin.requires) {
        visit(dep, next);
      }
    };
    expect(() => PLUGINS.forEach((p) => visit(p.id, new Set()))).not.toThrow();
  });

  it("contributed ipc groups match the plugin id", () => {
    const mismatches = PLUGINS.flatMap((plugin) => {
      const group = plugin.contributes?.ipcGroup;

      return group !== undefined && group !== plugin.id
        ? [`${plugin.id} → ${group}`]
        : [];
    });
    expect(mismatches).toEqual([]);
  });

  it("getPlugin throws on unknown id", () => {
    // @ts-expect-error -- intentional bad id for the test
    expect(() => getPlugin("nope")).toThrow(/Unknown plugin id/);
  });
});
