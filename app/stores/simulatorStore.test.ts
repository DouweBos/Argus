import type { SimulatorDevice } from "../lib/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSimulatorState,
  isTvOS,
  selectDevice,
  setBooting,
  setCapturing,
  setDevices,
  setDisconnected,
  setMjpegPort,
  setSimulatorState,
} from "./simulatorStore";

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

function resetSimulatorStore() {
  setSimulatorState({
    platform: "ios",
    iosToolsAvailable: null,
    iosToolsError: null,
    devices: [],
    selectedUdidByWorkspace: {},
    capturing: false,
    booting: false,
    disconnected: false,
    mjpegPort: null,
    androidToolsAvailable: null,
    androidToolsError: null,
    androidDevices: [],
    selectedAndroidByWorkspace: {},
    androidCapturing: false,
    androidBooting: false,
    androidDisconnected: false,
    browserPreset: "desktop",
    browserUrlByWorkspace: {},
    runtimeDialogOpen: false,
  });
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
    for (const key of Object.keys(mockStorage)) {
      delete mockStorage[key];
    }
    resetSimulatorStore();
  });

  it("sets devices", () => {
    setDevices([device()]);
    expect(getSimulatorState().devices).toHaveLength(1);
  });

  it("clears selected UDID when device disappears", () => {
    selectDevice("ws-1", "AAAA-BBBB");
    setDevices([device({ udid: "CCCC-DDDD" })]);
    expect(getSimulatorState().selectedUdidByWorkspace["ws-1"]).toBeNull();
  });

  it("preserves selected UDID when device still exists", () => {
    selectDevice("ws-1", "AAAA-BBBB");
    setDevices([device()]);
    expect(getSimulatorState().selectedUdidByWorkspace["ws-1"]).toBe(
      "AAAA-BBBB",
    );
  });

  it("selects a device for a workspace", () => {
    selectDevice("ws-1", "AAAA-BBBB");
    expect(getSimulatorState().selectedUdidByWorkspace["ws-1"]).toBe(
      "AAAA-BBBB",
    );
  });

  it("clears disconnected flag when selecting a device", () => {
    setDisconnected(true);
    selectDevice("ws-1", "AAAA-BBBB");
    expect(getSimulatorState().disconnected).toBe(false);
  });

  it("sets capturing state", () => {
    setCapturing(true);
    expect(getSimulatorState().capturing).toBe(true);
  });

  it("sets booting state", () => {
    setBooting(true);
    expect(getSimulatorState().booting).toBe(true);
  });

  it("sets MJPEG port", () => {
    setMjpegPort(8080);
    expect(getSimulatorState().mjpegPort).toBe(8080);
  });

  it("persists selection to localStorage", () => {
    selectDevice("ws-1", "AAAA-BBBB");
    const stored = JSON.parse(
      mockStorage["stagehand:simulatorByWorkspace"] ?? "{}",
    );
    expect(stored["ws-1"]).toBe("AAAA-BBBB");
  });
});
