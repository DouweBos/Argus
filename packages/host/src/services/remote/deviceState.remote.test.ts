/**
 * Fold and orientation over the wire: a client has to know how the device is
 * being held to present the stream upright, and moving it is a control action.
 */

import type { GatewayContext } from "./capabilities";
import type { PairedDevice } from "./deviceStore";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@argus/host/bus", () => ({ emitHostEvent: vi.fn() }));
vi.mock("../../state", () => ({
  appState: {
    agents: new Map(),
    agentSnapshots: new Map<string, string>(),
    agentPendingPermissions: new Map(),
    agentQueues: new Map(),
    sessions: new Map(),
  },
}));
vi.mock("../simulator/ios", () => ({
  isSimulatorCapturing: vi.fn(() => false),
  listSimulators: vi.fn(async () => []),
  simulatorButton: vi.fn(),
  simulatorKeyboard: vi.fn(),
  simulatorTouch: vi.fn(),
  simulatorDeviceState: vi.fn(async (udid: string) => ({
    udid,
    fold: { angle: 180, pose: "open" },
    orientation: "landscapeLeft",
    display: { width: 1080, height: 2340, rotation: 90, screenID: 7 },
  })),
  simulatorSetOrientation: vi.fn(async (udid: string) => ({
    udid,
    fold: null,
    orientation: "portrait",
    display: null,
  })),
  simulatorSetFold: vi.fn(async (udid: string) => ({
    udid,
    fold: { angle: 0, pose: "closed" },
    orientation: "portrait",
    display: null,
  })),
}));

const { dispatch } = await import("./capabilities");
const { simulatorSetFold, simulatorSetOrientation, simulatorDeviceState } =
  vi.mocked(await import("../simulator/ios"));

function makeCtx(capabilities: PairedDevice["capabilities"]): GatewayContext {
  return {
    device: {
      device_id: "dev-1",
      label: "Phone",
      dev_static_pub: "",
      capabilities,
      created_at: 0,
      last_seen: null,
    },
    connectionId: "conn-1",
    outstandingPermissions: new Set(),
  };
}

describe("devices.state", () => {
  beforeEach(() => {
    simulatorDeviceState.mockClear();
    simulatorSetFold.mockClear();
    simulatorSetOrientation.mockClear();
  });

  it("is readable by a monitor, in the wire's own casing", async () => {
    const res = await dispatch(
      "devices.state",
      { device_id: "udid-1", platform: "ios" },
      makeCtx(["monitor"]),
    );

    expect(res).toEqual({
      state: {
        device_id: "udid-1",
        fold: { angle: 180, pose: "open" },
        orientation: "landscapeLeft",
        display: { width: 1080, height: 2340, rotation: 90, screen_id: 7 },
      },
    });
  });

  it("reports nothing for Android rather than shelling out", async () => {
    const res = await dispatch(
      "devices.state",
      { device_id: "emulator-5554", platform: "android" },
      makeCtx(["monitor"]),
    );

    expect(res).toEqual({ state: null });
    expect(simulatorDeviceState).not.toHaveBeenCalled();
  });

  it("refuses to rotate or fold for a monitor", async () => {
    const ctx = makeCtx(["monitor"]);
    await expect(
      dispatch(
        "devices.set_orientation",
        { device_id: "udid-1", platform: "ios", orientation: "portrait" },
        ctx,
      ),
    ).rejects.toThrow(/capability/i);
    await expect(
      dispatch(
        "devices.set_fold",
        { device_id: "udid-1", platform: "ios", pose: "closed" },
        ctx,
      ),
    ).rejects.toThrow(/capability/i);
    expect(simulatorSetOrientation).not.toHaveBeenCalled();
    expect(simulatorSetFold).not.toHaveBeenCalled();
  });

  it("rotates and folds for a control device, answering with the new pose", async () => {
    const ctx = makeCtx(["control"]);
    await dispatch(
      "devices.set_orientation",
      { device_id: "udid-1", platform: "ios", orientation: "portrait" },
      ctx,
    );
    expect(simulatorSetOrientation).toHaveBeenCalledWith("udid-1", "portrait");

    const res = await dispatch(
      "devices.set_fold",
      { device_id: "udid-1", platform: "ios", pose: "closed" },
      ctx,
    );
    expect(simulatorSetFold).toHaveBeenCalledWith("udid-1", "closed");
    expect(res).toMatchObject({
      state: { fold: { angle: 0, pose: "closed" } },
    });
  });

  it("refuses to rotate an Android emulator, which rotates itself", async () => {
    await expect(
      dispatch(
        "devices.set_orientation",
        {
          device_id: "emulator-5554",
          platform: "android",
          orientation: "portrait",
        },
        makeCtx(["control"]),
      ),
    ).rejects.toThrow(/iOS-only/);
  });
});
