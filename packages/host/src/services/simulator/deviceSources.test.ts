import type {
  DeviceCaps,
  DeviceSession,
  DeviceSource,
  DeviceSourceProvider,
  VideoSink,
} from "./deviceSource";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../../state";
import { execConductor } from "../conductor/logger";
import { remoteDeviceId } from "../deviceHosts/deviceId";
import {
  addDeviceHost,
  removeDeviceHost,
  resetDeviceHostsForTests,
} from "../deviceHosts/registry";
import { getDeviceInputEndpoint } from "./deviceInput";
import { NO_CAPS } from "./deviceSource";
import {
  deviceCapabilities,
  deviceSourceIdOf,
  onDeviceSourceGone,
  registerDeviceSourceProvider,
  requireCapability,
  resolveDeviceSource,
} from "./deviceSources";
import {
  forceStopSimulatorCapture,
  simulatorDeviceState,
  simulatorSetOrientation,
  simulatorTouch,
  startSimulatorCapture,
} from "./ios";
import { localDeviceSource } from "./machineSource";
import { watchRemoteVideo } from "./remoteVideo";

vi.mock("../telemetry/telemetry", () => ({ capture: () => {} }));

/** A source with no shell behind it, the shape a cloud source would take. */
function fakeSource(id: string, caps: Partial<DeviceCaps> = {}) {
  const touches: number[][] = [];
  const sinks: VideoSink[] = [];
  let stopped = 0;
  const session: DeviceSession = {
    start: () => Promise.resolve(7),
    isAlive: () => stopped === 0,
    video: {
      open: (sink) => {
        sinks.push(sink);

        return { close: () => {} };
      },
    },
    adaptiveVideo: null,
    input: {
      touch: (x, y, t) => {
        touches.push([x, y, t]);

        return Promise.resolve();
      },
      button: () => Promise.resolve(),
      key: () => Promise.resolve(),
    },
    displayInfo: () => Promise.resolve(null),
    refreshDisplay: () => Promise.resolve(),
    stop: () => {
      stopped += 1;
    },
  };
  const source: DeviceSource = {
    id,
    list: () =>
      Promise.resolve([
        { udid: `${id}:dev`, name: "Cloud", runtime: "iOS 26.0", booted: true },
      ]),
    find: (dev) =>
      Promise.resolve(
        dev === `${id}:dev`
          ? { udid: dev, name: "Cloud", runtime: "iOS 26.0", booted: true }
          : undefined,
      ),
    open: () => Promise.resolve(),
    close: () => Promise.resolve(),
    erase: () => Promise.reject(new Error("no")),
    delete: () => Promise.reject(new Error("no")),
    session: () => session,
    capabilities: () => ({ ...NO_CAPS, ...caps }),
    unsupported: (cap) => `${cap} isn't available in the cloud.`,
  };

  return {
    source,
    touches,
    sinks,
    stopped: () => stopped,
  };
}

function prefixProvider(source: DeviceSource) {
  const gone = new Set<(id: string) => void>();
  const provider: DeviceSourceProvider = {
    sourceIdOf: (deviceId) =>
      deviceId.startsWith(`${source.id}:`) ? source.id : null,
    resolve: () => source,
    listable: () => [source],
    onGone: (l) => {
      gone.add(l);

      return () => gone.delete(l);
    },
  };

  return {
    provider,
    goAway: () => {
      for (const l of gone) {
        l(source.id);
      }
    },
  };
}

describe("device source resolution", () => {
  let home: string;
  let unregister: (() => void) | null = null;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "ds-"));
    process.env.ARGUS_HOME = home;
    resetDeviceHostsForTests();
  });

  afterEach(() => {
    unregister?.();
    unregister = null;
    resetDeviceHostsForTests();
    delete process.env.ARGUS_HOME;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("routes bare ids to this Mac and namespaced ids to their host", () => {
    const host = addDeviceHost({ target: "studio" });
    expect(resolveDeviceSource("LOCAL-UDID")).toBe(localDeviceSource);
    const remoteId = remoteDeviceId(host.id, "R");
    expect(resolveDeviceSource(remoteId).id).toBe(host.id);
    // Same source object on every lookup.
    expect(resolveDeviceSource(remoteId)).toBe(resolveDeviceSource(remoteId));
    expect(deviceSourceIdOf("LOCAL-UDID")).toBe("local");
    expect(() =>
      resolveDeviceSource(remoteDeviceId("rhffffffff", "R")),
    ).toThrow();
  });

  it("lets a new namespace register in front of the machine fallback", () => {
    const { source } = fakeSource("eas");
    unregister = registerDeviceSourceProvider(prefixProvider(source).provider);
    expect(resolveDeviceSource("eas:abc")).toBe(source);
    expect(resolveDeviceSource("LOCAL-UDID")).toBe(localDeviceSource);
    unregister();
    unregister = null;
    expect(resolveDeviceSource("eas:abc")).toBe(localDeviceSource);
  });

  it("gates a device host's pose and conductor by capability", async () => {
    const host = addDeviceHost({ target: "studio" });
    const remoteId = remoteDeviceId(host.id, "R");
    expect(deviceCapabilities("LOCAL-UDID")).toMatchObject({
      rotation: true,
      conductor: true,
    });
    expect(deviceCapabilities(remoteId)).toMatchObject({
      rotation: false,
      fold: false,
      conductor: false,
      erase: true,
      adaptiveVideo: true,
    });
    expect(() => requireCapability(remoteId, "rotation")).toThrow(
      /device host/,
    );
    await expect(
      simulatorSetOrientation(remoteId, "landscapeLeft"),
    ).rejects.toMatch(/Rotating and folding/);
    await expect(execConductor(remoteId, ["list-devices"])).rejects.toThrow(
      /conductor only reaches this Mac/,
    );
    await expect(getDeviceInputEndpoint(remoteId)).resolves.toBeNull();
    await expect(simulatorDeviceState(remoteId)).resolves.toEqual({
      udid: remoteId,
      fold: null,
      orientation: "portrait",
      display: null,
    });
    // A removed host's devices support nothing.
    removeDeviceHost(host.id);
    expect(deviceCapabilities(remoteId)).toEqual(NO_CAPS);
  });

  it("captures, drives and tears down a device from a plugged-in source", async () => {
    const fake = fakeSource("eas");
    const { provider, goAway } = prefixProvider(fake.source);
    unregister = registerDeviceSourceProvider(provider);
    const gone: string[] = [];
    const off = onDeviceSourceGone((id) => gone.push(id));

    await expect(startSimulatorCapture("eas:dev")).resolves.toBe(7);
    expect(appState.simulators.get("eas:dev")?.deviceName).toBe("Cloud");
    expect(fake.sinks).toHaveLength(1);
    await simulatorTouch("eas:dev", 0.25, 0.75, 0);
    expect(fake.touches).toEqual([[0.25, 0.75, 0]]);
    await expect(
      simulatorSetOrientation("eas:dev", "portrait"),
    ).rejects.toMatch(/rotation isn't available in the cloud/);

    // With no adaptive encode, a remote viewer rides the shared stream.
    const frames: boolean[] = [];
    const stop = watchRemoteVideo("eas:dev", "ios", {
      onConfig: () => {},
      onFrame: (_d, keyFrame) => frames.push(keyFrame),
      buffered: () => 0,
    });
    await Promise.resolve();
    fake.sinks[0].onFrame(new Uint8Array(4), true, 0);
    expect(frames).toEqual([true]);
    stop();

    goAway();
    off();
    expect(gone).toEqual(["eas"]);
    expect(fake.stopped()).toBe(1);
    expect(appState.simulators.has("eas:dev")).toBe(false);
    forceStopSimulatorCapture("eas:dev");
  });
});
