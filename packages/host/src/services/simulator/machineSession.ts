/**
 * A capture on a Mac Argus can run commands on: one argus-sim-bridge process
 * per device for video, touch and display info, plus the in-guest
 * argus-sim-input helper for keys and hardware buttons (the bridge's Indigo
 * path only still carries digitizer events).
 */

import type {
  AdaptiveVideoSource,
  DeviceInput,
  DeviceSession,
  VideoSource,
} from "./deviceSource";
import type { DisplayInfo } from "./deviceState";
import type { StreamTarget } from "./remoteBitrate";
import type { DeviceMachine } from "../deviceHosts/machine";
import { log } from "@argus/host/logger";
import { capture } from "../telemetry/telemetry";
import { readAnnexB } from "./annexBVideo";
import { SimBridge } from "./bridge";
import { rotationForUiOrientation } from "./deviceState";
import {
  HID_CONSUMER_USAGE,
  HID_PAGE_CONSUMER,
  HID_PAGE_KEYBOARD,
} from "./hidUsage";
import {
  type SimInputTarget,
  sendButtonUsage,
  sendKeyUsage,
  stopSimInput,
} from "./simInput";

function bridgeParams(target: StreamTarget): Record<string, number> {
  return {
    bitrate: target.bitrate,
    maxDim: target.level.maxDim,
    fps: target.level.fps,
  };
}

export class MachineSession implements DeviceSession {
  private readonly bridge = new SimBridge();
  private port: number | null = null;
  private readonly target: SimInputTarget;

  constructor(
    private readonly machine: DeviceMachine,
    /** Argus's id for the device. */
    private readonly deviceId: string,
    /** The UDID as `machine` knows it. */
    private readonly udid: string,
  ) {
    this.target = { deviceId, machine, udid };
  }

  async start(): Promise<number> {
    const { machine, bridge } = this;
    const remote = machine.hostId !== null;
    let response: Record<string, unknown>;
    try {
      if (remote) {
        const binary = await machine.toolPath("argus-sim-bridge");
        bridge.spawn(() => machine.spawn(binary, []));
      } else {
        bridge.spawn();
      }
      response = await bridge.sendCommand({
        cmd: "start_capture",
        udid: this.udid,
      });
    } catch (err) {
      bridge.kill();
      if (remote) {
        capture("remote_device_watched", { success: false });
      }
      throw `Bridge start_capture failed: ${String(err)}`;
    }
    if (!response.ok) {
      bridge.kill();
      if (remote) {
        capture("remote_device_watched", { success: false });
      }
      throw `Bridge start_capture failed: ${String(response.error ?? "unknown error")}`;
    }
    if (remote) {
      capture("remote_device_watched", { success: true });
    }
    this.port = response.port as number;

    return this.port;
  }

  isAlive(): boolean {
    return this.bridge.isAlive();
  }

  /** The bridge's own stream: loopback here, `ssh -W` to a device host's. */
  readonly video: VideoSource = {
    open: (sink) => {
      const port = this.port ?? 0;
      const socket = this.machine.connect(port);
      log(
        `[IosVideo] opening bridge stream on port ${String(port)} (${this.deviceId})`,
      );
      const close = readAnnexB(socket, sink);

      return { close };
    },
  };

  /** A second, bitrate-capped encode from the same bridge. */
  readonly adaptiveVideo: AdaptiveVideoSource = {
    start: async (target) => {
      const { bridge } = this;
      const response = await bridge.sendCommand({
        cmd: "start_remote_stream",
        ...bridgeParams(target),
      });
      if (!response.ok || typeof response.port !== "number") {
        // An older bridge binary without the remote encoder.
        throw new Error(
          String(response.error ?? "start_remote_stream refused"),
        );
      }
      const port = response.port;

      return {
        attach: (sink) => readAnnexB(this.machine.connect(port), sink),
        retarget: (next) => {
          bridge
            .sendCommand({ cmd: "set_stream_params", ...bridgeParams(next) })
            .catch(() => {});
        },
        stop: () => {
          bridge.sendCommand({ cmd: "stop_remote_stream" }).catch(() => {});
        },
      };
    },
  };

  readonly input: DeviceInput = {
    touch: async (x, y, eventType) => {
      const response = await this.bridge.sendCommand({
        cmd: "touch",
        udid: this.udid,
        x,
        y,
        type: eventType,
      });
      if (!response.ok) {
        throw `Touch failed: ${String(response.error ?? "unknown error")}`;
      }
    },
    button: async (button) => {
      // iOS hardware buttons go through the in-guest helper: the bridge's Indigo
      // button messages send without error but never reach the device.
      const consumerUsage = HID_CONSUMER_USAGE[button];
      if (consumerUsage !== undefined) {
        return sendButtonUsage(this.target, HID_PAGE_CONSUMER, consumerUsage);
      }
      const response = await this.bridge.sendCommand({
        cmd: "button",
        udid: this.udid,
        button,
      });
      if (!response.ok) {
        throw `Button failed: ${String(response.error ?? "unknown error")}`;
      }
    },
    key: (usage, down) =>
      sendKeyUsage(this.target, HID_PAGE_KEYBOARD, usage, down),
  };

  async displayInfo(): Promise<DisplayInfo | null> {
    try {
      const res = await this.bridge.sendCommand({ cmd: "display_info" });
      if (!res.ok) {
        return null;
      }

      return {
        width: res.width as number,
        height: res.height as number,
        screenID: res.screenID as number,
        rotation: rotationForUiOrientation(res.uiOrientation as number),
      };
    } catch {
      return null;
    }
  }

  async refreshDisplay(): Promise<void> {
    await this.bridge.sendCommand({ cmd: "refresh_display" });
  }

  stop(): void {
    stopSimInput(this.deviceId);
    // Best-effort — ignore errors on teardown
    this.bridge.sendCommand({ cmd: "stop_capture" }).catch(() => {});
    this.bridge.kill();
  }
}
