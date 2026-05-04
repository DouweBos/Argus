import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetPluginsStateForTests,
  getEnabledPluginsForRenderer,
  pluginEnabled,
  setEnabledPluginsFromRenderer,
} from "./state";

// Redirect `~/.argus` to a per-test scratch dir so the migration probe and
// the persisted `plugins.json` don't touch the developer's real config.
let scratchHome: string;
vi.mock("../onboarding/state", () => ({
  argusDirPath: () => scratchHome,
  ensureArgusDir: () => {
    fs.mkdirSync(scratchHome, { recursive: true });

    return scratchHome;
  },
}));

function setUpScratch() {
  scratchHome = fs.mkdtempSync(path.join(os.tmpdir(), "argus-plugins-state-"));
  __resetPluginsStateForTests();
}

function tearDownScratch() {
  fs.rmSync(scratchHome, { recursive: true, force: true });
}

describe("plugin state — fresh install", () => {
  beforeEach(setUpScratch);
  afterEach(tearDownScratch);

  it("returns an empty map (default-disabled) when neither config nor plugins.json exist", () => {
    expect(getEnabledPluginsForRenderer()).toEqual({});
    expect(pluginEnabled("device-recording")).toBe(false);
  });

  it("treats incomplete onboarding as a fresh install and stays default-disabled", () => {
    fs.writeFileSync(
      path.join(scratchHome, "config.json"),
      JSON.stringify({ onboarding: { completed: false } }),
    );
    expect(pluginEnabled("device-control")).toBe(false);
  });
});

describe("plugin state — migration for existing installs", () => {
  beforeEach(setUpScratch);
  afterEach(tearDownScratch);

  it("seeds every plugin to enabled when prior onboarding completed", () => {
    fs.mkdirSync(scratchHome, { recursive: true });
    fs.writeFileSync(
      path.join(scratchHome, "config.json"),
      JSON.stringify({ onboarding: { completed: true } }),
    );

    expect(pluginEnabled("device-recording")).toBe(true);
    expect(pluginEnabled("device-control")).toBe(true);
    expect(pluginEnabled("device-debug")).toBe(true);
    expect(pluginEnabled("device-inspector")).toBe(true);

    // Migration must persist so it doesn't run again on the next launch.
    const persisted = JSON.parse(
      fs.readFileSync(path.join(scratchHome, "plugins.json"), "utf8"),
    ) as { userEnabled: Record<string, boolean> };
    expect(persisted.userEnabled["device-recording"]).toBe(true);
  });

  it("does not re-seed if plugins.json already exists", () => {
    fs.mkdirSync(scratchHome, { recursive: true });
    fs.writeFileSync(
      path.join(scratchHome, "config.json"),
      JSON.stringify({ onboarding: { completed: true } }),
    );
    // The user has previously turned `device-recording` off.
    fs.writeFileSync(
      path.join(scratchHome, "plugins.json"),
      JSON.stringify({
        version: 1,
        userEnabled: { "device-recording": false },
      }),
    );

    expect(pluginEnabled("device-recording")).toBe(false);
  });
});

describe("plugin state — requires cascading", () => {
  beforeEach(setUpScratch);
  afterEach(tearDownScratch);

  it("disabling a base force-disables dependents", () => {
    setEnabledPluginsFromRenderer({
      "device-recording": false,
      "device-inspector": true,
    });
    expect(pluginEnabled("device-inspector")).toBe(false);
  });

  it("device-debug requires device-control", () => {
    setEnabledPluginsFromRenderer({
      "device-control": false,
      "device-debug": true,
    });
    expect(pluginEnabled("device-debug")).toBe(false);
  });

  it("a base alone is enough — no dependents required", () => {
    setEnabledPluginsFromRenderer({
      "device-recording": true,
      "device-inspector": false,
    });
    expect(pluginEnabled("device-recording")).toBe(true);
  });
});

describe("plugin state — IPC gate behaviour", () => {
  beforeEach(setUpScratch);
  afterEach(tearDownScratch);

  it("`pluginEnabled` returns true when the plugin is the source of truth", () => {
    setEnabledPluginsFromRenderer({ "device-recording": true });
    expect(pluginEnabled("device-recording")).toBe(true);
  });

  it("`pluginEnabled` returns false right after a disable, so handlers can early-reject", () => {
    setEnabledPluginsFromRenderer({ "device-recording": true });
    expect(pluginEnabled("device-recording")).toBe(true);

    setEnabledPluginsFromRenderer({ "device-recording": false });
    expect(pluginEnabled("device-recording")).toBe(false);
  });
});
