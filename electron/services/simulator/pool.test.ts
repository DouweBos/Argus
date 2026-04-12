import type { SimulatorDevice } from "./ios";
import { execFile } from "node:child_process";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { appState } from "../../state";
import { listSimulators, bootSimulator } from "./ios";
import {
  simulatorPool,
  projectPrefix,
  nextDeviceName,
  iphoneModelNumber,
} from "./pool";

// ---------------------------------------------------------------------------
// Mocks — must be declared before any imports that use them.
// ---------------------------------------------------------------------------

// Mock child_process.execFile used by pool.ts (via promisify).
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

// Mock ios.ts exports consumed by pool.ts.
vi.mock("./ios", () => ({
  listSimulators: vi.fn(),
  bootSimulator: vi.fn(),
}));

// Mock electron so state.ts can be imported without Electron runtime.
vi.mock("electron", () => ({ app: { isPackaged: false } }));

// Mock main.ts to avoid Electron window references.
vi.mock("../../main", () => ({ getMainWindow: () => null }));

const mockExecFile = vi.mocked(execFile);
const mockListSimulators = vi.mocked(listSimulators);
const mockBootSimulator = vi.mocked(bootSimulator);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fake SimulatorDevice for tests. */
function fakeDevice(
  name: string,
  udid: string,
  booted = true,
): SimulatorDevice {
  return { name, udid, runtime: "iOS 18.0", booted };
}

/**
 * Make mockExecFile invoke its callback with the given stdout. Matches any
 * invocation — callers can narrow with mockImplementation if needed.
 */
function stubExecFile(stdout: string): void {
  mockExecFile.mockImplementation(
    (_cmd: unknown, _args: unknown, cb: unknown) => {
      if (typeof cb === "function") {
        (cb as (err: null, result: { stdout: string }) => void)(null, {
          stdout,
        });
      }

      return undefined as never;
    },
  );
}

/**
 * Stub execFile to return different stdout depending on the simctl subcommand.
 */
function stubSimctlCreate(createdUdid: string): void {
  const deviceTypes = JSON.stringify({
    devicetypes: [
      {
        identifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-16",
        name: "iPhone 16",
      },
    ],
  });
  const runtimes = JSON.stringify({
    runtimes: [
      {
        identifier: "com.apple.CoreSimulator.SimRuntime.iOS-18-0",
        name: "iOS 18.0",
        isAvailable: true,
      },
    ],
  });

  mockExecFile.mockImplementation(
    (_cmd: unknown, args: unknown, cb: unknown) => {
      const argv = args as string[];
      let stdout = "";
      if (argv.includes("devicetypes")) {
        stdout = deviceTypes;
      } else if (argv.includes("runtimes")) {
        stdout = runtimes;
      } else if (argv.includes("create")) {
        stdout = `${createdUdid}\n`;
      }
      if (typeof cb === "function") {
        (cb as (err: null, result: { stdout: string }) => void)(null, {
          stdout,
        });
      }

      return undefined as never;
    },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("projectPrefix", () => {
  it("extracts directory name from absolute path", () => {
    expect(projectPrefix("/Users/dev/Projects/MyApp")).toBe("MyApp");
  });

  it("handles trailing slash", () => {
    expect(projectPrefix("/Users/dev/MyApp/")).toBe("MyApp");
  });

  it("handles root path", () => {
    // path.basename("/") returns "" on POSIX
    expect(typeof projectPrefix("/")).toBe("string");
  });
});

describe("nextDeviceName", () => {
  it("returns prefix-1 when no existing names", () => {
    expect(nextDeviceName("MyApp", [])).toBe("MyApp-1");
  });

  it("returns next sequential number", () => {
    expect(nextDeviceName("MyApp", ["MyApp-1", "MyApp-2"])).toBe("MyApp-3");
  });

  it("fills gaps in the sequence", () => {
    expect(nextDeviceName("MyApp", ["MyApp-1", "MyApp-3"])).toBe("MyApp-2");
  });

  it("handles single existing name", () => {
    expect(nextDeviceName("Proj", ["Proj-1"])).toBe("Proj-2");
  });

  it("ignores non-matching names", () => {
    expect(nextDeviceName("MyApp", ["Other-1", "Other-2"])).toBe("MyApp-1");
  });
});

describe("iphoneModelNumber", () => {
  it("extracts numeric model from standard names", () => {
    expect(iphoneModelNumber("iPhone 16")).toBe(16);
    expect(iphoneModelNumber("iPhone 16 Pro Max")).toBe(16);
    expect(iphoneModelNumber("iPhone 6s Plus")).toBe(6);
    expect(iphoneModelNumber("iPhone 12 mini")).toBe(12);
  });

  it("maps iPhone X variants to generation 10", () => {
    expect(iphoneModelNumber("iPhone X")).toBe(10);
    expect(iphoneModelNumber("iPhone XS")).toBe(10);
    expect(iphoneModelNumber("iPhone XS Max")).toBe(10);
    expect(iphoneModelNumber("iPhone XR")).toBe(10);
  });

  it("returns 0 for unrecognized names", () => {
    expect(iphoneModelNumber("iPad Pro")).toBe(0);
  });
});

describe("simulatorPool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear all reservations between tests.
    appState.simulatorReservations.clear();
  });

  describe("acquireSimulator", () => {
    it("reuses a free project-prefixed simulator", async () => {
      mockListSimulators.mockResolvedValue([
        fakeDevice("MyApp-1", "uuid-1"),
        fakeDevice("iPhone 16", "uuid-other"),
      ]);

      const udid = await simulatorPool.acquireSimulator(
        "agent-1",
        "/Users/dev/MyApp",
      );

      expect(udid).toBe("uuid-1");
      expect(mockBootSimulator).not.toHaveBeenCalled(); // already booted
      expect(appState.simulatorReservations.get("agent-1")).toEqual({
        agentId: "agent-1",
        udid: "uuid-1",
        deviceName: "MyApp-1",
        repoRoot: "/Users/dev/MyApp",
      });
    });

    it("boots a free simulator that is not booted", async () => {
      mockListSimulators.mockResolvedValue([
        fakeDevice("MyApp-1", "uuid-1", false),
      ]);
      mockBootSimulator.mockResolvedValue(undefined);

      const udid = await simulatorPool.acquireSimulator(
        "agent-1",
        "/Users/dev/MyApp",
      );

      expect(udid).toBe("uuid-1");
      expect(mockBootSimulator).toHaveBeenCalledWith("uuid-1");
    });

    it("creates a new simulator when all project sims are reserved", async () => {
      // Existing sim is already reserved by another agent.
      appState.simulatorReservations.set("agent-existing", {
        agentId: "agent-existing",
        udid: "uuid-1",
        deviceName: "MyApp-1",
        repoRoot: "/Users/dev/MyApp",
      });

      mockListSimulators.mockResolvedValue([fakeDevice("MyApp-1", "uuid-1")]);
      mockBootSimulator.mockResolvedValue(undefined);
      stubSimctlCreate("uuid-new");

      const udid = await simulatorPool.acquireSimulator(
        "agent-2",
        "/Users/dev/MyApp",
      );

      expect(udid).toBe("uuid-new");
      expect(mockBootSimulator).toHaveBeenCalledWith("uuid-new");
      expect(appState.simulatorReservations.get("agent-2")?.deviceName).toBe(
        "MyApp-2",
      );
    });

    it("creates a simulator when no project sims exist", async () => {
      mockListSimulators.mockResolvedValue([
        fakeDevice("iPhone 16", "uuid-other"),
      ]);
      mockBootSimulator.mockResolvedValue(undefined);
      stubSimctlCreate("uuid-fresh");

      const udid = await simulatorPool.acquireSimulator(
        "agent-1",
        "/Users/dev/MyApp",
      );

      expect(udid).toBe("uuid-fresh");
      expect(appState.simulatorReservations.get("agent-1")?.deviceName).toBe(
        "MyApp-1",
      );
    });

    it("selects the highest model number, not the last in the list", async () => {
      mockListSimulators.mockResolvedValue([]);
      mockBootSimulator.mockResolvedValue(undefined);

      const deviceTypes = JSON.stringify({
        devicetypes: [
          {
            identifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-16",
            name: "iPhone 16",
          },
          {
            identifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-16-Plus",
            name: "iPhone 16 Plus",
          },
          {
            identifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-6s-Plus",
            name: "iPhone 6s Plus",
          },
        ],
      });
      const runtimes = JSON.stringify({
        runtimes: [
          {
            identifier: "com.apple.CoreSimulator.SimRuntime.iOS-26-2",
            name: "iOS 26.2",
            isAvailable: true,
          },
        ],
      });

      const createArgs: string[] = [];
      mockExecFile.mockImplementation(
        (_cmd: unknown, args: unknown, cb: unknown) => {
          const argv = args as string[];
          let stdout = "";
          if (argv.includes("devicetypes")) {
            stdout = deviceTypes;
          } else if (argv.includes("runtimes")) {
            stdout = runtimes;
          } else if (argv.includes("create")) {
            createArgs.push(...argv);
            stdout = "uuid-new\n";
          }
          if (typeof cb === "function") {
            (cb as (err: null, result: { stdout: string }) => void)(null, {
              stdout,
            });
          }

          return undefined as never;
        },
      );

      await simulatorPool.acquireSimulator("agent-model", "/Users/dev/MyApp");

      // Must pick iPhone 16 (model 16), NOT iPhone 6s Plus (model 6).
      expect(createArgs).toContain(
        "com.apple.CoreSimulator.SimDeviceType.iPhone-16",
      );
      expect(createArgs).not.toContain(
        "com.apple.CoreSimulator.SimDeviceType.iPhone-6s-Plus",
      );
    });

    it("serializes concurrent acquisitions to avoid races", async () => {
      let callCount = 0;
      mockListSimulators.mockImplementation(async () => {
        callCount++;
        // On the first call no project sims exist. On the second call the
        // first agent's freshly created sim should already be reserved.
        if (callCount === 1) {
          return [fakeDevice("iPhone 16", "uuid-other")];
        }

        return [
          fakeDevice("iPhone 16", "uuid-other"),
          fakeDevice("MyApp-1", "uuid-first"),
        ];
      });
      mockBootSimulator.mockResolvedValue(undefined);

      let createCallIndex = 0;
      const deviceTypes = JSON.stringify({
        devicetypes: [
          {
            identifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-16",
            name: "iPhone 16",
          },
        ],
      });
      const runtimes = JSON.stringify({
        runtimes: [
          {
            identifier: "com.apple.CoreSimulator.SimRuntime.iOS-18-0",
            name: "iOS 18.0",
            isAvailable: true,
          },
        ],
      });

      mockExecFile.mockImplementation(
        (_cmd: unknown, args: unknown, cb: unknown) => {
          const argv = args as string[];
          let stdout = "";
          if (argv.includes("devicetypes")) {
            stdout = deviceTypes;
          } else if (argv.includes("runtimes")) {
            stdout = runtimes;
          } else if (argv.includes("create")) {
            createCallIndex++;
            stdout = createCallIndex === 1 ? "uuid-first\n" : "uuid-second\n";
          }
          if (typeof cb === "function") {
            (cb as (err: null, result: { stdout: string }) => void)(null, {
              stdout,
            });
          }

          return undefined as never;
        },
      );

      // Fire both acquisitions concurrently.
      const [udid1, udid2] = await Promise.all([
        simulatorPool.acquireSimulator("agent-a", "/Users/dev/MyApp"),
        simulatorPool.acquireSimulator("agent-b", "/Users/dev/MyApp"),
      ]);

      // They should get different simulators.
      expect(udid1).not.toBe(udid2);
      expect(appState.simulatorReservations.size).toBe(2);
    });
  });

  describe("releaseSimulator", () => {
    it("removes the reservation and calls conductor cleanup", async () => {
      appState.simulatorReservations.set("agent-1", {
        agentId: "agent-1",
        udid: "uuid-1",
        deviceName: "MyApp-1",
        repoRoot: "/Users/dev/MyApp",
      });

      // Stub conductor calls to succeed.
      stubExecFile("");

      await simulatorPool.releaseSimulator("agent-1");

      expect(appState.simulatorReservations.has("agent-1")).toBe(false);
      // Should have called conductor uninstall-app and session --clear.
      expect(mockExecFile).toHaveBeenCalledTimes(2);
    });

    it("is idempotent — second release is a no-op", async () => {
      appState.simulatorReservations.set("agent-1", {
        agentId: "agent-1",
        udid: "uuid-1",
        deviceName: "MyApp-1",
        repoRoot: "/Users/dev/MyApp",
      });

      stubExecFile("");

      await simulatorPool.releaseSimulator("agent-1");
      await simulatorPool.releaseSimulator("agent-1");

      expect(appState.simulatorReservations.has("agent-1")).toBe(false);
    });

    it("succeeds even when conductor commands fail", async () => {
      appState.simulatorReservations.set("agent-1", {
        agentId: "agent-1",
        udid: "uuid-1",
        deviceName: "MyApp-1",
        repoRoot: "/Users/dev/MyApp",
      });

      mockExecFile.mockImplementation(
        (_cmd: unknown, _args: unknown, cb: unknown) => {
          if (typeof cb === "function") {
            (cb as (err: Error) => void)(new Error("conductor not found"));
          }

          return undefined as never;
        },
      );

      // Should not throw.
      await simulatorPool.releaseSimulator("agent-1");
      expect(appState.simulatorReservations.has("agent-1")).toBe(false);
    });

    it("no-ops for an unknown agent", async () => {
      await expect(
        simulatorPool.releaseSimulator("nonexistent"),
      ).resolves.toBeUndefined();
    });
  });

  describe("getReservedUdid", () => {
    it("returns the UDID for a reserved agent", () => {
      appState.simulatorReservations.set("agent-1", {
        agentId: "agent-1",
        udid: "uuid-1",
        deviceName: "MyApp-1",
        repoRoot: "/Users/dev/MyApp",
      });

      expect(simulatorPool.getReservedUdid("agent-1")).toBe("uuid-1");
    });

    it("returns null for an unreserved agent", () => {
      expect(simulatorPool.getReservedUdid("nonexistent")).toBeNull();
    });
  });
});
