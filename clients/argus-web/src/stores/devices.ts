/**
 * Simulators and emulators: the list, live screens, input, pose and who holds
 * the input claim. Mirrors `HostStore+Devices`.
 */

import { create } from "zustand";
import {
  describeError,
  INITIAL_LOAD,
  isQuietError,
  type LoadState,
} from "@argus/client-core";
import type { MediaMessage } from "@argus/remote-client";
import type {
  RemoteDevice,
  RemoteDeviceClaim,
  RemoteDeviceClaimState,
  RemoteDeviceOrientation,
  RemoteDeviceState,
  RemoteFoldPose,
  RemotePlatform,
} from "../lib/protocol";
import { request } from "../lib/request";
import { currentTransport, media } from "./connection";

interface DevicesState {
  /** Connected simulators/emulators (from devices.list). */
  devices: RemoteDevice[];
  /** How the last `devices.list` went, for the list's `LoadPhase`. */
  devicesLoad: LoadState;
  /** Who holds input per device, so a locked-out client says so rather than
   *  tapping at a picture that never answers. */
  claimByDevice: Record<string, RemoteDeviceClaim | null>;
  /** Our own connection id, learned the first time the host grants us a claim. */
  claimConnectionId: string | null;
  /** How each watched device is being held, so the stream is presented upright. */
  deviceStateById: Record<string, RemoteDeviceState | null>;

  /** `background` for polls and resumes: a dropped connection stays quiet. */
  refreshDevices: (options?: { background?: boolean }) => Promise<void>;
  /** Start streaming a device's screen; returns the binary-frame stream id. */
  watchDevice: (deviceId: string, platform: RemotePlatform) => Promise<number>;
  unwatchDevice: (deviceId: string) => Promise<void>;
  /** Seed a device's pose; the host pushes `device.state` while we watch it. */
  loadDeviceState: (
    deviceId: string,
    platform: RemotePlatform,
  ) => Promise<void>;
  /** Rotate the device. Arbitrated by the same claim as a tap. */
  setDeviceOrientation: (
    deviceId: string,
    platform: RemotePlatform,
    orientation: RemoteDeviceOrientation,
  ) => Promise<void>;
  /** Move a foldable's hinge. */
  setDeviceFold: (
    deviceId: string,
    platform: RemotePlatform,
    pose: RemoteFoldPose,
  ) => Promise<void>;
  /** Route parsed media frames for a stream to a sink (the device view). */
  registerMediaSink: (
    streamId: number,
    sink: (msg: MediaMessage) => void,
  ) => () => void;
  /** Fire-and-forget touch (moves are unawaited to avoid head-of-line latency). */
  deviceTouch: (
    deviceId: string,
    platform: RemotePlatform,
    x: number,
    y: number,
    eventType: 0 | 1 | 2,
  ) => void;
  deviceButton: (
    deviceId: string,
    platform: RemotePlatform,
    button: string,
  ) => Promise<void>;
  deviceKeyboard: (
    deviceId: string,
    platform: RemotePlatform,
    keyCode: number,
    modifiers: number,
    isDown: boolean,
  ) => void;
  /** Seed who holds a device before the first input, so the overlay is right. */
  loadClaim: (deviceId: string) => Promise<void>;
  /** Take the claim; `force` steals it from a live holder. */
  claimDevice: (deviceId: string, force?: boolean) => Promise<void>;
  releaseDevice: (deviceId: string) => void;
}

/** Adopt the holder a refused input reports, in case it beat the broadcast. */
function adoptClaimDenial(err: unknown): void {
  const data =
    err && typeof err === "object" && "data" in err
      ? (err as { data: unknown }).data
      : null;
  if (
    data &&
    typeof data === "object" &&
    typeof (data as RemoteDeviceClaimState).device_id === "string"
  ) {
    receiveClaim(data as RemoteDeviceClaimState);
  }
}

function setDeviceState(deviceId: string, state: RemoteDeviceState | null) {
  useDevicesStore.setState((s) => ({
    deviceStateById: { ...s.deviceStateById, [deviceId]: state },
  }));
}

export const useDevicesStore = create<DevicesState>()((set) => ({
  devices: [],
  devicesLoad: INITIAL_LOAD,
  claimByDevice: {},
  claimConnectionId: null,
  deviceStateById: {},

  refreshDevices: async (options) => {
    const t = currentTransport();
    if (!t) {
      return;
    }
    try {
      const { devices } = await request(t, "devices.list", {});
      set({ devices, devicesLoad: { loaded: true, error: null } });
    } catch (err) {
      // The toolchain may be missing; any prior list stays on screen.
      if (!isQuietError(err, options?.background ?? false)) {
        set({ devicesLoad: { loaded: true, error: describeError(err) } });
      }
    }
  },

  watchDevice: async (deviceId, platform) => {
    const t = currentTransport();
    if (!t) {
      throw new Error("not connected");
    }
    const { stream_id } = await request(t, "devices.watch", {
      device_id: deviceId,
      platform,
    });

    return stream_id;
  },

  unwatchDevice: async (deviceId) => {
    const t = currentTransport();
    if (t) {
      await request(t, "devices.unwatch", { device_id: deviceId }).catch(
        () => {},
      );
    }
  },

  loadDeviceState: async (deviceId, platform) => {
    const t = currentTransport();
    if (!t) {
      return;
    }
    try {
      const { state } = await request(t, "devices.state", {
        device_id: deviceId,
        platform,
      });
      setDeviceState(deviceId, state);
    } catch {
      // Android reports no pose, and an older host may not answer at all;
      // either way, portrait is the right assumption.
    }
  },

  // Pose writes adopt the state they answer with, so the picture turns with
  // the press rather than waiting on the host's next poll.
  setDeviceOrientation: async (deviceId, platform, orientation) => {
    const t = currentTransport();
    if (!t) {
      return;
    }
    try {
      const { state } = await request(t, "devices.set_orientation", {
        device_id: deviceId,
        platform,
        orientation,
      });
      setDeviceState(deviceId, state);
    } catch (err) {
      adoptClaimDenial(err);
    }
  },

  setDeviceFold: async (deviceId, platform, pose) => {
    const t = currentTransport();
    if (!t) {
      return;
    }
    try {
      const { state } = await request(t, "devices.set_fold", {
        device_id: deviceId,
        platform,
        pose,
      });
      setDeviceState(deviceId, state);
    } catch (err) {
      adoptClaimDenial(err);
    }
  },

  registerMediaSink: (streamId, sink) => media.register(streamId, sink),

  deviceTouch: (deviceId, platform, x, y, eventType) => {
    const t = currentTransport();
    // Unawaited: touch-move latency compounds if we round-trip each event.
    if (t) {
      request(t, "devices.touch", {
        device_id: deviceId,
        platform,
        x,
        y,
        event_type: eventType,
      }).catch(adoptClaimDenial);
    }
  },

  deviceButton: async (deviceId, platform, button) => {
    const t = currentTransport();
    if (t) {
      await request(t, "devices.button", {
        device_id: deviceId,
        platform,
        button,
      }).catch(adoptClaimDenial);
    }
  },

  deviceKeyboard: (deviceId, platform, keyCode, modifiers, isDown) => {
    const t = currentTransport();
    if (t) {
      request(t, "devices.keyboard", {
        device_id: deviceId,
        platform,
        key_code: keyCode,
        modifiers,
        is_down: isDown,
      }).catch(adoptClaimDenial);
    }
  },

  loadClaim: async (deviceId) => {
    const t = currentTransport();
    if (!t) {
      return;
    }
    try {
      const { holder, connection_id } = await request(
        t,
        "devices.claim_status",
        { device_id: deviceId },
      );
      set((s) => ({
        claimByDevice: { ...s.claimByDevice, [deviceId]: holder },
        // Our own id, so "who holds it" can be answered however the claim
        // was taken, including implicitly by a tap.
        claimConnectionId: connection_id,
      }));
    } catch {
      // Monitor-only clients can't ask; they can't drive either, so no overlay.
    }
  },

  claimDevice: async (deviceId, force) => {
    const t = currentTransport();
    if (!t) {
      return;
    }
    try {
      const res = await request(t, "devices.claim", {
        device_id: deviceId,
        force: force ?? false,
      });
      set((s) => ({
        claimByDevice: { ...s.claimByDevice, [deviceId]: res.holder },
        claimConnectionId: res.granted
          ? (res.holder?.connection_id ?? s.claimConnectionId)
          : s.claimConnectionId,
      }));
    } catch (err) {
      adoptClaimDenial(err);
    }
  },

  releaseDevice: (deviceId) => {
    const t = currentTransport();
    if (t) {
      request(t, "devices.release", { device_id: deviceId }).catch(() => {});
    }
  },
}));

/** `device.claim`: the claim moved, including being stolen from us. */
export function receiveClaim(claim: RemoteDeviceClaimState): void {
  useDevicesStore.setState((s) => ({
    claimByDevice: { ...s.claimByDevice, [claim.device_id]: claim.holder },
  }));
}

/**
 * `device.state`: the hinge and orientation move from the desktop or an agent
 * as easily as from here, so the host is the only source worth trusting.
 */
export function receiveDeviceState(state: RemoteDeviceState): void {
  setDeviceState(state.device_id, state);
}

/** A new host: its devices aren't the last one's. */
export function resetDevices(): void {
  useDevicesStore.setState({ devices: [], devicesLoad: INITIAL_LOAD });
}
