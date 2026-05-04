import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetToolStoreForTests,
  getEffectiveToolEnabled,
  getUserEnabled,
  setToolEnabled,
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

describe("tool store", () => {
  beforeEach(() => {
    for (const key of Object.keys(mockStorage)) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- test reset
      delete mockStorage[key];
    }
    __resetToolStoreForTests();
  });

  it("falls back to defaultEnabled (true) when the user hasn't toggled", () => {
    expect(getUserEnabled("device-recording")).toBe(true);
  });

  it("respects an explicit user toggle", () => {
    setToolEnabled("device-recording", true);
    expect(getUserEnabled("device-recording")).toBe(true);
  });

  it("persists user toggles to localStorage", () => {
    setToolEnabled("device-control", true);
    expect(mockStorage["argus:tools"]).toContain("device-control");
  });

  it("force-disables dependents when a base is off", () => {
    setToolEnabled("device-recording", true);
    setToolEnabled("device-inspector", true);
    expect(getEffectiveToolEnabled("device-inspector")).toBe(true);
    setToolEnabled("device-recording", false);
    expect(getEffectiveToolEnabled("device-inspector")).toBe(false);
    // The user toggle on the dependent itself is unchanged.
    expect(getUserEnabled("device-inspector")).toBe(true);
  });

  it("project mask hides tools from effective state", () => {
    setToolEnabled("device-control", true);
    setToolEnabled("device-debug", true);
    expect(getEffectiveToolEnabled("device-debug")).toBe(true);
    setProjectDisabled(["device-debug"]);
    expect(getEffectiveToolEnabled("device-debug")).toBe(false);
    expect(getUserEnabled("device-debug")).toBe(true);
  });

  it("project mask cascades through `requires` like user toggles", () => {
    setToolEnabled("device-control", true);
    setToolEnabled("device-debug", true);
    setProjectDisabled(["device-control"]);
    expect(getEffectiveToolEnabled("device-debug")).toBe(false);
  });

  it("clearing the project mask restores effective state", () => {
    setToolEnabled("device-recording", true);
    setToolEnabled("device-inspector", true);
    setProjectDisabled(["device-recording"]);
    expect(getEffectiveToolEnabled("device-inspector")).toBe(false);
    setProjectDisabled([]);
    expect(getEffectiveToolEnabled("device-inspector")).toBe(true);
  });
});
