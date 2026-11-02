import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadAppSettings, migrateLegacyDefaultModel } from "./store";

let home: string;

function writeSettings(settings: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(home, "app-settings.json"),
    JSON.stringify({ version: 1, settings }),
  );
}

describe("migrateLegacyDefaultModel", () => {
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "app-settings-"));
    process.env.ARGUS_HOME = home;
  });

  afterEach(() => {
    delete process.env.ARGUS_HOME;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("carries default_model into an unset default_llm.model", () => {
    writeSettings({ default_model: "opus", default_llm: { runner: "x" } });
    migrateLegacyDefaultModel();
    expect(loadAppSettings()).toEqual({
      default_llm: { runner: "x", model: "opus" },
    });
  });

  it("keeps a model already set and drops the legacy key", () => {
    writeSettings({
      default_model: "opus",
      default_llm: { runner: null, model: "sonnet" },
    });
    migrateLegacyDefaultModel();
    expect(loadAppSettings()).toEqual({
      default_llm: { runner: null, model: "sonnet" },
    });
  });

  it("drops an empty legacy value without adding a model", () => {
    writeSettings({ default_model: "", theme: "dark" });
    migrateLegacyDefaultModel();
    expect(loadAppSettings()).toEqual({ theme: "dark" });
  });
});
