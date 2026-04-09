import { describe, expect, it } from "vitest";
import { defaultSetupConfig, defaultStagehandConfig } from "./models";

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

describe("defaultStagehandConfig", () => {
  it("returns empty config with null optionals", () => {
    const config = defaultStagehandConfig();
    expect(config.setup.copy).toEqual([]);
    expect(config.terminals).toEqual([]);
    expect(config.workspace_env).toEqual([]);
    expect(config.run).toBeNull();
  });

  it("returns empty related_projects array", () => {
    const config = defaultStagehandConfig();
    expect(config.related_projects).toEqual([]);
  });

  it("returns a new instance each time", () => {
    const a = defaultStagehandConfig();
    const b = defaultStagehandConfig();
    expect(a).not.toBe(b);
  });
});
