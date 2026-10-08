import { z } from "zod";
import {
  AndroidDevice,
  ConductorLogEntry,
  DebugCommandResult,
  DebugStreamInfo,
  DeviceInfo,
  DeviceInputEndpoint,
  DeviceOrientation,
  DevicePlatform,
  FoldPose,
  InjectionProbe,
  InspectionAck,
  InstalledApp,
  NodeProps,
  SimulatorDevice,
  SimulatorDeviceState,
} from "../models/devices";
import { type CommandSpec, NoParams, Void } from "./spec";

const Udid = z.object({ udid: z.string() });
const Serial = z.object({ serial: z.string() });
const DeviceKey = z.object({ deviceKey: z.string() });
const Touch = z.object({ x: z.number(), y: z.number(), eventType: z.number() });
const ConductorArgs = DeviceKey.extend({ args: z.array(z.string()) });

// The picker and toolchain probes stay ungated — the renderer uses them to show
// "Install Xcode" hints regardless of tool state. Capture and input are gated.
const SIMULATOR_COMMANDS = {
  check_ios_tools: { tier: "admin", params: NoParams, result: Void },
  list_simulators: {
    tier: "admin",
    params: NoParams,
    result: z.array(SimulatorDevice),
  },
  boot_simulator: { tier: "admin", params: Udid, result: Void },
  /** Resets it to a fresh install; also recreates a missing data folder. */
  erase_simulator: { tier: "admin", params: Udid, result: Void },
  delete_simulator: { tier: "admin", params: Udid, result: Void },
  disconnect_simulator: { tier: "admin", params: Udid, result: Void },
  active_simulator: {
    tier: "admin",
    params: NoParams,
    result: z.string().nullable(),
  },
  /** Resolves with the stream port. */
  start_simulator_capture: {
    tier: "admin",
    tool: "device-recording",
    params: Udid,
    result: z.number(),
  },
  stop_simulator_capture: {
    tier: "admin",
    tool: "device-recording",
    params: Udid,
    result: Void,
  },
  simulator_touch: {
    tier: "admin",
    tool: "device-control",
    params: Udid.extend(Touch.shape),
    result: Void,
  },
  simulator_device_state: {
    tier: "monitor",
    tool: "device-control",
    params: Udid,
    result: SimulatorDeviceState,
  },
  simulator_set_fold: {
    tier: "admin",
    tool: "device-control",
    params: Udid.extend({ pose: z.union([FoldPose, z.number()]) }),
    result: SimulatorDeviceState,
  },
  simulator_set_orientation: {
    tier: "admin",
    tool: "device-control",
    params: Udid.extend({ orientation: DeviceOrientation }),
    result: SimulatorDeviceState,
  },
  simulator_button: {
    tier: "admin",
    tool: "device-control",
    params: Udid.extend({ button: z.string() }),
    result: Void,
  },
  simulator_keyboard: {
    tier: "admin",
    tool: "device-control",
    params: Udid.extend({
      keyCode: z.number(),
      modifierFlags: z.number(),
      isDown: z.boolean(),
    }),
    result: Void,
  },
  /** Null when conductor can't provide one; the caller uses native input. */
  device_input_endpoint: {
    tier: "admin",
    tool: "device-control",
    params: DeviceKey,
    result: DeviceInputEndpoint.nullable(),
  },
  device_open_link: {
    tier: "admin",
    tool: "device-control",
    params: DeviceKey.extend({ url: z.string() }),
    result: Void,
  },
} as const satisfies Record<string, CommandSpec>;

const ANDROID_COMMANDS = {
  check_android_tools: { tier: "admin", params: NoParams, result: Void },
  list_android_devices: {
    tier: "admin",
    params: NoParams,
    result: z.array(AndroidDevice),
  },
  list_avds: { tier: "admin", params: NoParams, result: z.array(z.string()) },
  /** Resolves with the booted emulator's serial. */
  boot_android_emulator: {
    tier: "admin",
    params: z.object({ avdName: z.string() }),
    result: z.string(),
  },
  start_android_capture: {
    tier: "admin",
    tool: "device-recording",
    params: Serial,
    result: Void,
  },
  /** No serial stops every capture. */
  stop_android_capture: {
    tier: "admin",
    tool: "device-recording",
    params: z.object({ serial: z.string().optional() }),
    result: Void,
  },
  disconnect_android_device: {
    tier: "admin",
    tool: "device-recording",
    params: Serial,
    result: Void,
  },
  android_touch: {
    tier: "admin",
    tool: "device-control",
    params: Serial.extend(Touch.shape),
    result: Void,
  },
  android_keyboard: {
    tier: "admin",
    tool: "device-control",
    params: Serial.extend({
      keyCode: z.number(),
      metaState: z.number(),
      isDown: z.boolean(),
    }),
    result: Void,
  },
  android_button: {
    tier: "admin",
    tool: "device-control",
    params: Serial.extend({ button: z.string() }),
    result: Void,
  },
} as const satisfies Record<string, CommandSpec>;

const CONDUCTOR_COMMANDS = {
  list_devices: {
    tier: "admin",
    params: NoParams,
    result: z.array(DeviceInfo),
  },
  stop_device: {
    tier: "admin",
    params: DeviceKey.extend({ platform: DevicePlatform }),
    result: Void,
  },
  list_conductor_logs: {
    tier: "admin",
    tool: "device-control",
    params: DeviceKey,
    result: z.array(ConductorLogEntry),
  },
  /** Appends `--device <deviceKey>` unless the args already name one. */
  run_conductor_command: {
    tier: "admin",
    tool: "device-control",
    params: ConductorArgs,
    result: Void,
  },
  /** The raw `capture-ui` tree; the renderer normalises it. */
  inspection_capture: {
    tier: "admin",
    tool: "device-inspector",
    params: DeviceKey,
    result: z.unknown(),
  },
  inspection_probe: {
    tier: "admin",
    tool: "device-inspector",
    params: DeviceKey,
    result: InjectionProbe,
  },
  inspection_list_apps: {
    tier: "admin",
    tool: "device-inspector",
    params: DeviceKey,
    result: z.array(InstalledApp),
  },
  inspection_launch_injected: {
    tier: "admin",
    tool: "device-inspector",
    params: DeviceKey.extend({ bundleId: z.string() }),
    result: InspectionAck,
  },
  inspection_set_property: {
    tier: "admin",
    tool: "device-inspector",
    params: DeviceKey.extend({
      nodeId: z.string(),
      key: z.string(),
      value: z.string(),
    }),
    result: InspectionAck,
  },
  inspection_node_props: {
    tier: "admin",
    tool: "device-inspector",
    params: DeviceKey.extend({ nodeId: z.string() }),
    result: NodeProps,
  },
  debug_start_stream: {
    tier: "admin",
    tool: "device-debug",
    params: ConductorArgs.extend({ streamId: z.string() }),
    result: z.null(),
  },
  debug_stop_stream: {
    tier: "admin",
    tool: "device-debug",
    params: z.object({ streamId: z.string() }),
    result: z.null(),
  },
  debug_list_streams: {
    tier: "admin",
    tool: "device-debug",
    params: NoParams,
    result: z.array(DebugStreamInfo),
  },
  debug_run_command: {
    tier: "admin",
    tool: "device-debug",
    params: ConductorArgs,
    result: DebugCommandResult,
  },
} as const satisfies Record<string, CommandSpec>;

export const DEVICE_COMMANDS = {
  ...SIMULATOR_COMMANDS,
  ...ANDROID_COMMANDS,
  ...CONDUCTOR_COMMANDS,
} as const satisfies Record<string, CommandSpec>;
