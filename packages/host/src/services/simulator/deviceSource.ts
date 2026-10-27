/**
 * What Argus does with an iOS device, independent of how it reaches it. A
 * source lists, boots and captures devices; this Mac and every SSH device host
 * are one (`MachineDeviceSource`), and a cloud source that has no shell plugs in
 * next to them through `registerDeviceSourceProvider`.
 *
 * Device ids stay what they are on the wire: a bare UDID here, `<hostId>~<udid>`
 * on a device host. A source maps them to whatever it addresses internally.
 */

import type { DisplayInfo } from "./deviceState";
import type { H264Config } from "./h264-parser";
import type { StreamTarget } from "./remoteBitrate";
import type { SimulatorProblem } from "./simctlProblems";

/** Source id of this Mac. Device-host sources use their host id. */
export const LOCAL_SOURCE_ID = "local";

/** A discovered iOS simulator device. */
export interface SimulatorDevice {
  /** Device id: the UDID here, `<hostId>~<udid>` on a device host. */
  udid: string;
  name: string;
  runtime: string;
  booted: boolean;
  /** Why it can't boot as it is, when simctl's listing already shows it. */
  problem?: SimulatorProblem;
  /** Device host it runs on; absent for this machine. */
  deviceHostId?: string;
  /** That host's label. */
  deviceHostLabel?: string;
}

/** What a device supports beyond watching and touching it. */
export interface DeviceCaps {
  /** Reads and sets the device's orientation. */
  rotation: boolean;
  /** Reads and moves a foldable's hinge. */
  fold: boolean;
  /** conductor can drive it: agents, the device log, its input socket. */
  conductor: boolean;
  /** Appearance, permissions, location and the like (all via conductor). */
  settings: boolean;
  erase: boolean;
  delete: boolean;
  /** A second, retargetable encode for remote viewers. */
  adaptiveVideo: boolean;
}

export type DeviceCapability = keyof DeviceCaps;

export const NO_CAPS: DeviceCaps = {
  rotation: false,
  fold: false,
  conductor: false,
  settings: false,
  erase: false,
  delete: false,
  adaptiveVideo: false,
};

/** H.264 access units, however the source produces them. */
export interface VideoSink {
  onConfig: (config: H264Config) => void;
  onFrame: (data: Uint8Array, keyFrame: boolean, timestamp: number) => void;
  onError?: (err: Error) => void;
  /** The stream ended, on its own or after the consumer closed it. */
  onClose?: () => void;
}

/** A running stream; `close` is idempotent. */
export interface VideoStream {
  close: () => void;
}

/** The device's shared stream, the one every local view decodes. */
export interface VideoSource {
  open: (sink: VideoSink) => VideoStream;
}

/** A second encode retargeted per remote viewer conditions. */
export interface AdaptiveVideoStream {
  /** Start delivering; returns a detach that stops delivery but not the encode. */
  attach: (sink: VideoSink) => () => void;
  retarget: (target: StreamTarget) => void;
  /** Stop the encode itself. */
  stop: () => void;
}

export interface AdaptiveVideoSource {
  /** Rejects when the source can't serve one right now; callers fall back. */
  start: (target: StreamTarget) => Promise<AdaptiveVideoStream>;
}

/** Touch, hardware buttons and keyboard. */
export interface DeviceInput {
  /** `x`/`y` normalized to [0, 1]; `eventType` 0 down, 1 drag, 2 up. */
  touch: (x: number, y: number, eventType: number) => Promise<void>;
  /** A named button ("home", "lock", …) as a down+up pair. */
  button: (button: string) => Promise<void>;
  /** A key down or up by HID usage on the keyboard page. */
  key: (usage: number, down: boolean) => Promise<void>;
}

/**
 * One capture of one device: its video, input and display, alive until
 * `stop`. Created idle so a teardown racing the start can still stop it.
 */
export interface DeviceSession {
  /** Resolves with the capture handle `start_simulator_capture` returns. */
  start: () => Promise<number>;
  isAlive: () => boolean;
  readonly video: VideoSource;
  /** Null when the source has no adaptive encode. */
  readonly adaptiveVideo: AdaptiveVideoSource | null;
  readonly input: DeviceInput;
  /** The captured panel and its rotation; null when unknown. */
  displayInfo: () => Promise<DisplayInfo | null>;
  /** Re-pick the live panel after a fold. */
  refreshDisplay: () => Promise<void>;
  stop: () => void;
}

export interface DeviceSource {
  readonly id: string;
  list: () => Promise<SimulatorDevice[]>;
  /** One device by id, asking only this source. */
  find: (id: string) => Promise<SimulatorDevice | undefined>;
  /** Boot and wait until usable; already running is fine. */
  open: (id: string) => Promise<void>;
  /** Shut down; already shut down is fine. */
  close: (id: string) => Promise<void>;
  /** Bring the device's own window forward, where it has one. */
  show?: (id: string) => void;
  /** Reject with the raw failure; callers describe it. */
  erase: (id: string) => Promise<void>;
  delete: (id: string) => Promise<void>;
  session: (id: string) => DeviceSession;
  capabilities: (id: string) => DeviceCaps;
  /** User-facing reason a capability is missing. */
  unsupported: (capability: DeviceCapability) => string;
}

/** Owns a namespace of device ids and the sources behind it. */
export interface DeviceSourceProvider {
  /** The owning source's id, or null when the id isn't in this namespace. Pure. */
  sourceIdOf: (deviceId: string) => string | null;
  /** The live source; throws a user-facing string when it's gone. */
  resolve: (sourceId: string) => DeviceSource;
  /** Sources other than this Mac worth listing right now. */
  listable: () => DeviceSource[];
  /** Fires when a source goes away for good; its captures must stop. */
  onGone: (listener: (sourceId: string) => void) => () => void;
}
