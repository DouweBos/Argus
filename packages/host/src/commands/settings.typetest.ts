import type { Equal, Expect } from "./typeEquality";
import type { AppSettings as HostAppSettings } from "../services/appSettings/store";
import type { ConductorStatus as HostConductorStatus } from "../services/conductor/override";
import type {
  DependencyReport as HostDependencyReport,
  DependencyStatus as HostDependencyStatus,
} from "../services/dependencies/check";
import type { EditorDescriptor as HostEditorDescriptor } from "../services/shell/editors";
import type {
  TelemetryInit as HostTelemetryInit,
  TelemetryMode as HostTelemetryMode,
} from "../services/telemetry/telemetry";
import type { getEnabledToolsForRenderer } from "../services/tools/state";
import type {
  AppSettings,
  ConductorStatus,
  DependencyReport,
  DependencyStatus,
  EditorDescriptor,
  EnabledTools,
  TelemetryInit,
  TelemetryMode,
} from "@argus/remote-protocol";

export type SettingsModelChecks = [
  Expect<Equal<AppSettings, HostAppSettings>>,
  Expect<Equal<DependencyStatus, HostDependencyStatus>>,
  Expect<Equal<DependencyReport, HostDependencyReport>>,
  Expect<Equal<EditorDescriptor, HostEditorDescriptor>>,
  Expect<Equal<ConductorStatus, HostConductorStatus>>,
  Expect<Equal<TelemetryMode, HostTelemetryMode>>,
  Expect<Equal<TelemetryInit, HostTelemetryInit>>,
  Expect<Equal<EnabledTools, ReturnType<typeof getEnabledToolsForRenderer>>>,
];
