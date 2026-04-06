import { describe, expect, it, beforeEach, vi } from "vitest";
import { useSimulatorStore, isTvOS } from "./simulatorStore";
import type { SimulatorDevice } from "../lib/types";

// Mock localStorage
const mockStorage: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  getItem: (key: string) => mockStorage[key] ?? null,
  setItem: (key: string, value: string) => {
    mockStorage[key] = value;
  },
  removeItem: (key: string) => {
    delete mockStorage[key];
  },
});

function device(overrides: Partial<SimulatorDevice> = {}): SimulatorDevice {
  return {
    udid: "AAAA-BBBB",
    name: "iPhone 16",
    runtime: "iOS 18.0",
    booted: false,
    ...overrides,
  };
}

describe("isTvOS", () => {
  it("returns true for tvOS devices", () => {
    expect(isTvOS(device({ runtime: "tvOS 18.0" }))).toBe(true);
  });

  it("returns false for iOS devices", () => {
    expect(isTvOS(device({ runtime: "iOS 18.0" }))).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isTvOS(undefined)).toBe(false);
  });
});

describe("simulatorStore", () => {
  beforeEach(() => {
    for (const key of Object.keys(mockStorage)) delete mockStorage[key];
    useSimulatorStore.setState({
      devices: [],
      selectedUdidByWorkspace: {},
      capturing: false,
      booting: false,
      disconnected: false,
      mjpegPort: null,
    });
  });

  it("sets devices", () => {
    useSimulatorStore.getState().setDevices([device()]);
    expect(useSimulatorStore.getState().devices).toHaveLength(1);
  });

  it("clears selected UDID when device disappears", () => {
    useSimulatorStore.getState().selectDevice("ws-1", "AAAA-BBBB");
    // Set devices without the selected one
    useSimulatorStore.getState().setDevices([device({ udid: "CCCC-DDDD" })]);
    expect(
      useSimulatorStore.getState().selectedUdidByWorkspace["ws-1"],
    ).toBeNull();
  });

  it("preserves selected UDID when device still exists", () => {
    useSimulatorStore.getState().selectDevice("ws-1", "AAAA-BBBB");
    useSimulatorStore.getState().setDevices([device()]);
    expect(useSimulatorStore.getState().selectedUdidByWorkspace["ws-1"]).toBe(
      "AAAA-BBBB",
    );
  });

  it("selects a device for a workspace", () => {
    useSimulatorStore.getState().selectDevice("ws-1", "AAAA-BBBB");
    expect(useSimulatorStore.getState().selectedUdidByWorkspace["ws-1"]).toBe(
      "AAAA-BBBB",
    );
  });

  it("clears disconnected flag when selecting a device", () => {
    useSimulatorStore.getState().setDisconnected(true);
    useSimulatorStore.getState().selectDevice("ws-1", "AAAA-BBBB");
    expect(useSimulatorStore.getState().disconnected).toBe(false);
  });

  it("sets capturing state", () => {
    useSimulatorStore.getState().setCapturing(true);
    expect(useSimulatorStore.getState().capturing).toBe(true);
  });

  it("sets booting state", () => {
    useSimulatorStore.getState().setBooting(true);
    expect(useSimulatorStore.getState().booting).toBe(true);
  });

  it("sets MJPEG port", () => {
    useSimulatorStore.getState().setMjpegPort(8080);
    expect(useSimulatorStore.getState().mjpegPort).toBe(8080);
  });

  it("persists selection to localStorage", () => {
    useSimulatorStore.getState().selectDevice("ws-1", "AAAA-BBBB");
    const stored = JSON.parse(
      mockStorage["stagehand:simulatorByWorkspace"] ?? "{}",
    );
    expect(stored["ws-1"]).toBe("AAAA-BBBB");
  });
});
