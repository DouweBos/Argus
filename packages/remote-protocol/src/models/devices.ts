import { z } from "zod";

/** A discovered iOS simulator device. */
export const SimulatorDevice = z.object({
  booted: z.boolean(),
  name: z.string(),
  runtime: z.string(),
  udid: z.string(),
});
export type SimulatorDevice = z.infer<typeof SimulatorDevice>;

/** Named hinge poses, matching conductor's vocabulary. */
export const FoldPose = z.enum(["book", "closed", "open", "partial"]);
export type FoldPose = z.infer<typeof FoldPose>;

/** Orientations conductor accepts for iOS. */
export const DeviceOrientation = z.enum([
  "landscapeLeft",
  "landscapeRight",
  "portrait",
  "portraitUpsideDown",
]);
export type DeviceOrientation = z.infer<typeof DeviceOrientation>;

export const FoldState = z.object({
  /** Hinge angle in degrees: 0 is shut, 180 is flat open. */
  angle: z.number(),
  pose: FoldPose,
});
export type FoldState = z.infer<typeof FoldState>;

/** The panel currently being captured, and how its contents are rotated. */
export const DisplayInfo = z.object({
  /** Framebuffer height in pixels, before rotation. */
  height: z.number(),
  /** Clockwise degrees the view must rotate the stream by to sit upright. */
  rotation: z.literal([0, 90, 180, 270]),
  /** CoreSimulator screen ID — changes when a fold lights the other panel. */
  screenID: z.number(),
  /** Framebuffer width in pixels, before rotation. */
  width: z.number(),
});
export type DisplayInfo = z.infer<typeof DisplayInfo>;

export const SimulatorDeviceState = z.object({
  /** Null while nothing is being captured. */
  display: DisplayInfo.nullable(),
  /** Null on devices with no hinge, which is every simulator but the Duo. */
  fold: FoldState.nullable(),
  orientation: DeviceOrientation,
  udid: z.string(),
});
export type SimulatorDeviceState = z.infer<typeof SimulatorDeviceState>;

export const DeviceInputEndpoint = z.object({
  device: z.string(),
  inputPort: z.number(),
  platform: z.string(),
  /** ws://127.0.0.1:<inputPort>/input */
  url: z.string(),
});
export type DeviceInputEndpoint = z.infer<typeof DeviceInputEndpoint>;

export const AndroidDevice = z.object({
  /** AVD name (only for emulators — used to boot). Null for physical devices. */
  avdName: z.string().nullable(),
  /** Android TV form factor (Chromecast / leanback) — dpad-driven, not touch. */
  isTv: z.boolean(),
  name: z.string(),
  online: z.boolean(),
  serial: z.string(),
  type: z.enum(["emulator", "physical"]),
});
export type AndroidDevice = z.infer<typeof AndroidDevice>;

export const DevicePlatform = z.enum(["android", "ios", "web"]);
export type DevicePlatform = z.infer<typeof DevicePlatform>;

export const DeviceInfo = z.object({
  /** Agent that owns this device, if any. */
  agentId: z.string().nullable(),
  /** Stable key used for conductor log bucketing: UDID, serial, or browser deviceId. */
  deviceKey: z.string(),
  name: z.string(),
  /** True if the device is booted/online. */
  online: z.boolean(),
  platform: DevicePlatform,
  /** Repo root of the owning session. */
  repoRoot: z.string().nullable(),
  /** Key used when talking to pool/stream APIs for this device. */
  reservationKey: z.string(),
  /** True if the device is currently reserved by an agent. */
  reserved: z.boolean(),
  /** iOS runtime string (e.g. "iOS 18.0"). Empty for other platforms. */
  runtime: z.string().optional(),
  /** Session the owning agent belongs to. */
  sessionId: z.string().nullable(),
  /** Absolute path of the owning session. */
  sessionPath: z.string().nullable(),
});
export type DeviceInfo = z.infer<typeof DeviceInfo>;

export const ConductorLogKind = z.enum(["cli", "http"]);
export type ConductorLogKind = z.infer<typeof ConductorLogKind>;

export const ConductorLogEntry = z.object({
  /** Argv for cli, or JSON body for http. */
  args: z.string(),
  /** Command or HTTP path. */
  command: z.string(),
  /** UDID for iOS sims, serial for Android, conductor deviceId for web browsers. */
  deviceKey: z.string(),
  /** Milliseconds the call took. */
  durationMs: z.number(),
  error: z.string().optional(),
  id: z.number(),
  kind: ConductorLogKind,
  ok: z.boolean(),
  /** Truncated stdout / response body. */
  output: z.string().optional(),
  ts: z.number(),
});
export type ConductorLogEntry = z.infer<typeof ConductorLogEntry>;

export const InjectionProbe = z.object({
  /** Foreground app bundle id, or null when on the home screen / unknown. */
  foregroundApp: z.string().nullable(),
  /** The in-process server answered `native-ping` — ready to inspect. */
  injected: z.boolean(),
  /** True when nothing inspectable is foregrounded (SpringBoard / home screen). */
  isSpringboard: z.boolean(),
});
export type InjectionProbe = z.infer<typeof InjectionProbe>;

export const InstalledApp = z.object({
  bundleId: z.string(),
  name: z.string(),
});
export type InstalledApp = z.infer<typeof InstalledApp>;

export const InspectionAck = z.object({ ok: z.boolean() });
export type InspectionAck = z.infer<typeof InspectionAck>;

export const NodeProps = z.object({
  class: z.string().optional(),
  id: z.string().optional(),
  isFabric: z.boolean().optional(),
  note: z.string().optional(),
  props: z.record(z.string(), z.unknown()).nullish(),
  rawProps: z.record(z.string(), z.unknown()).nullish(),
  status: z.string().optional(),
});
export type NodeProps = z.infer<typeof NodeProps>;

/** A running debug-panel conductor stream. */
export const DebugStreamInfo = z.object({
  command: z.string(),
  deviceKey: z.string(),
  streamId: z.string(),
});
export type DebugStreamInfo = z.infer<typeof DebugStreamInfo>;

export const DebugCommandResult = z.object({
  durationMs: z.number(),
  error: z.string().optional(),
  ok: z.boolean(),
  stderr: z.string().optional(),
  stdout: z.string(),
});
export type DebugCommandResult = z.infer<typeof DebugCommandResult>;
