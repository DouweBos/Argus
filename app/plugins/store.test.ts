import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetPluginStoreForTests,
  getEffectivePluginEnabled,
  getUserEnabled,
  setPluginEnabled,
  setProjectDisabled,
} from "./store";

const mockStorage: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  getItem: (key: string) => mockStorage[key] ?? null,
  setItem: (key: string, value: string) => {
    mockStorage[key] = value;
  },
  removeItem: (key: string) => {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- test-only mock storage reset
    delete mockStorage[key];
  },
});

describe("plugin store", () => {
  beforeEach(() => {
    for (const key of Object.keys(mockStorage)) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- test reset
      delete mockStorage[key];
    }
    __resetPluginStoreForTests();
  });

  it("falls back to defaultEnabled (false) when the user hasn't toggled", () => {
    expect(getUserEnabled("device-recording")).toBe(false);
  });

  it("respects an explicit user toggle", () => {
    setPluginEnabled("device-recording", true);
    expect(getUserEnabled("device-recording")).toBe(true);
  });

  it("persists user toggles to localStorage", () => {
    setPluginEnabled("device-control", true);
    expect(mockStorage["argus:plugins"]).toContain("device-control");
  });

  it("force-disables dependents when a base is off", () => {
    setPluginEnabled("device-recording", true);
    setPluginEnabled("device-inspector", true);
    expect(getEffectivePluginEnabled("device-inspector")).toBe(true);
    setPluginEnabled("device-recording", false);
    expect(getEffectivePluginEnabled("device-inspector")).toBe(false);
    // The user toggle on the dependent itself is unchanged.
    expect(getUserEnabled("device-inspector")).toBe(true);
  });

  it("project mask hides plugins from effective state", () => {
    setPluginEnabled("device-control", true);
    setPluginEnabled("device-debug", true);
    expect(getEffectivePluginEnabled("device-debug")).toBe(true);
    setProjectDisabled(["device-debug"]);
    expect(getEffectivePluginEnabled("device-debug")).toBe(false);
    expect(getUserEnabled("device-debug")).toBe(true);
  });

  it("project mask cascades through `requires` like user toggles", () => {
    setPluginEnabled("device-control", true);
    setPluginEnabled("device-debug", true);
    setProjectDisabled(["device-control"]);
    expect(getEffectivePluginEnabled("device-debug")).toBe(false);
  });

  it("clearing the project mask restores effective state", () => {
    setPluginEnabled("device-recording", true);
    setPluginEnabled("device-inspector", true);
    setProjectDisabled(["device-recording"]);
    expect(getEffectivePluginEnabled("device-inspector")).toBe(false);
    setProjectDisabled([]);
    expect(getEffectivePluginEnabled("device-inspector")).toBe(true);
  });
});
