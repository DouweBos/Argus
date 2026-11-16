import { describe, expect, it, vi } from "vitest";
import { artifactEnv } from "./runner";

const settings: { claude_artifacts?: boolean } = {};

vi.mock("../../../appSettings/store", () => ({
  loadAppSettings: () => settings,
}));

describe("artifactEnv", () => {
  it("turns Artifacts on unless the setting is off, and never lets the CLI open a browser", () => {
    delete settings.claude_artifacts;
    expect(artifactEnv()).toEqual({
      CLAUDE_CODE_ARTIFACT: "1",
      CLAUDE_CODE_ARTIFACT_AUTO_OPEN: "0",
    });
    settings.claude_artifacts = false;
    expect(artifactEnv().CLAUDE_CODE_ARTIFACT).toBe("0");
  });
});
