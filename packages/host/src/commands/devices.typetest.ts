import type { Equal, Expect } from "./typeEquality";
import type { listDebugStreams } from "../services/conductor/debug";
import type { DebugCommandResult as HostDebugCommandResult } from "../services/conductor/debug";
import type {
  DeviceInfo as HostDeviceInfo,
  DevicePlatform as HostDevicePlatform,
} from "../services/conductor/devices";
import type {
  ConductorLogEntry as HostConductorLogEntry,
  ConductorLogKind as HostConductorLogKind,
} from "../services/conductor/logger";
import type { SetPropertyRequest } from "../services/inspection/edit";
import type {
  InjectionProbe as HostInjectionProbe,
  InstalledApp as HostInstalledApp,
} from "../services/inspection/launcher";
import type { NodeProps as HostNodeProps } from "../services/inspection/props";
import type { AndroidDevice as HostAndroidDevice } from "../services/simulator/android";
import type { DeviceInputEndpoint as HostDeviceInputEndpoint } from "../services/simulator/deviceInput";
import type {
  DeviceOrientation as HostDeviceOrientation,
  DisplayInfo as HostDisplayInfo,
  FoldPose as HostFoldPose,
  FoldState as HostFoldState,
  SimulatorDeviceState as HostSimulatorDeviceState,
} from "../services/simulator/deviceState";
import type { SimulatorDevice as HostSimulatorDevice } from "../services/simulator/ios";
import type {
  AndroidDevice,
  ConductorLogEntry,
  ConductorLogKind,
  DebugCommandResult,
  DebugStreamInfo,
  DeviceInfo,
  DeviceInputEndpoint,
  DeviceOrientation,
  DevicePlatform,
  DisplayInfo,
  FoldPose,
  FoldState,
  InjectionProbe,
  InstalledApp,
  NodeProps,
  ParamsOf,
  SimulatorDevice,
  SimulatorDeviceState,
} from "@argus/remote-protocol";

export type DeviceModelChecks = [
  Expect<Equal<SimulatorDevice, HostSimulatorDevice>>,
  Expect<Equal<FoldPose, HostFoldPose>>,
  Expect<Equal<DeviceOrientation, HostDeviceOrientation>>,
  Expect<Equal<FoldState, HostFoldState>>,
  Expect<Equal<DisplayInfo, HostDisplayInfo>>,
  Expect<Equal<SimulatorDeviceState, HostSimulatorDeviceState>>,
  Expect<Equal<DeviceInputEndpoint, HostDeviceInputEndpoint>>,
  Expect<Equal<AndroidDevice, HostAndroidDevice>>,
  Expect<Equal<DevicePlatform, HostDevicePlatform>>,
  Expect<Equal<DeviceInfo, HostDeviceInfo>>,
  Expect<Equal<ConductorLogKind, HostConductorLogKind>>,
  Expect<Equal<ConductorLogEntry, HostConductorLogEntry>>,
  Expect<Equal<InjectionProbe, HostInjectionProbe>>,
  Expect<Equal<InstalledApp, HostInstalledApp>>,
  Expect<Equal<NodeProps, HostNodeProps>>,
  Expect<Equal<DebugStreamInfo, ReturnType<typeof listDebugStreams>[number]>>,
  Expect<Equal<DebugCommandResult, HostDebugCommandResult>>,
  Expect<Equal<ParamsOf<"inspection_set_property">, SetPropertyRequest>>,
];
