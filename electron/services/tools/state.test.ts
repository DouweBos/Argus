import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetToolsStateForTests,
  getEnabledToolsForRenderer,
  toolEnabled,
  setEnabledToolsFromRenderer,
} from "./state";

// Redirect `~/.argus` to a per-test scratch dir so the persisted
// `tools.json` doesn't touch the developer's real config.
let scratchHome: string;
vi.mock("../onboarding/state", () => ({
  argusDirPath: () => scratchHome,
  ensureArgusDir: () => {
    fs.mkdirSync(scratchHome, { recursive: true });

    return scratchHome;
  },
}));

function setUpScratch() {
  scratchHome = fs.mkdtempSync(path.join(os.tmpdir(), "argus-tools-state-"));
  __resetToolsStateForTests();
}

function tearDownScratch() {
  fs.rmSync(scratchHome, { recursive: true, force: true });
}

describe("tool state — fresh install", () => {
  beforeEach(setUpScratch);
  afterEach(tearDownScratch);

  it("returns an empty map and falls back to default-enabled when neither config nor tools.json exist", () => {
    expect(getEnabledToolsForRenderer()).toEqual({});
    expect(toolEnabled("device-recording")).toBe(true);
  });

  it("treats incomplete onboarding as a fresh install with defaults applied", () => {
    fs.writeFileSync(
      path.join(scratchHome, "config.json"),
      JSON.stringify({ onboarding: { completed: false } }),
    );
    expect(toolEnabled("device-control")).toBe(true);
  });
});

describe("tool state — requires cascading", () => {
  beforeEach(setUpScratch);
  afterEach(tearDownScratch);

  it("disabling a base force-disables dependents", () => {
    setEnabledToolsFromRenderer({
      "device-recording": false,
      "device-inspector": true,
    });
    expect(toolEnabled("device-inspector")).toBe(false);
  });

  it("device-debug requires device-control", () => {
    setEnabledToolsFromRenderer({
      "device-control": false,
      "device-debug": true,
    });
    expect(toolEnabled("device-debug")).toBe(false);
  });

  it("a base alone is enough — no dependents required", () => {
    setEnabledToolsFromRenderer({
      "device-recording": true,
      "device-inspector": false,
    });
    expect(toolEnabled("device-recording")).toBe(true);
  });
});

describe("tool state — IPC gate behaviour", () => {
  beforeEach(setUpScratch);
  afterEach(tearDownScratch);

  it("`toolEnabled` returns true when the tool is the source of truth", () => {
    setEnabledToolsFromRenderer({ "device-recording": true });
    expect(toolEnabled("device-recording")).toBe(true);
  });

  it("`toolEnabled` returns false right after a disable, so handlers can early-reject", () => {
    setEnabledToolsFromRenderer({ "device-recording": true });
    expect(toolEnabled("device-recording")).toBe(true);

    setEnabledToolsFromRenderer({ "device-recording": false });
    expect(toolEnabled("device-recording")).toBe(false);
  });
});
