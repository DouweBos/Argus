import { describe, expect, it } from "vitest";
import { defaultSetupConfig, defaultArgusConfig } from "./models";

describe("defaultSetupConfig", () => {
  it("returns empty arrays", () => {
    const config = defaultSetupConfig();
    expect(config.copy).toEqual([]);
    expect(config.symlink).toEqual([]);
    expect(config.commands).toEqual([]);
  });

  it("returns a new instance each time", () => {
    const a = defaultSetupConfig();
    const b = defaultSetupConfig();
    expect(a).not.toBe(b);
    a.copy.push("mutated");
    expect(b.copy).toEqual([]);
  });
});

describe("defaultArgusConfig", () => {
  it("returns empty config with null optionals", () => {
    const config = defaultArgusConfig();
    expect(config.setup.copy).toEqual([]);
    expect(config.terminals).toEqual([]);
    expect(config.workspace_env).toEqual([]);
    expect(config.run).toBeNull();
  });

  it("returns empty related_projects array", () => {
    const config = defaultArgusConfig();
    expect(config.related_projects).toEqual([]);
  });

  it("returns a new instance each time", () => {
    const a = defaultArgusConfig();
    const b = defaultArgusConfig();
    expect(a).not.toBe(b);
  });
});
