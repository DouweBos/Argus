import { z } from "zod";
import {
  AppSettings,
  ConductorStatus,
  DependencyReport,
  EditorDescriptor,
  EnabledTools,
  SecretStoreId,
  TelemetryInit,
  TelemetryMode,
} from "../models/settings";
import { type CommandSpec, NoParams, Void } from "./spec";

const HostPath = z.object({ path: z.string() });

/** Telemetry props are typed by the sender's event catalog, not here. */
const TelemetryProps = z.record(z.string(), z.unknown());

export const SETTINGS_COMMANDS = {
  get_app_settings: { tier: "admin", params: NoParams, result: AppSettings },
  /** Merges the given keys over the stored settings; returns the result. */
  set_app_settings: {
    tier: "admin",
    params: z.object({ settings: AppSettings }),
    result: AppSettings,
  },
  check_dependencies: {
    tier: "admin",
    params: NoParams,
    result: DependencyReport,
  },
  /** Lightweight persisted key/value blobs (e.g. last route). */
  ui_state_get: {
    tier: "admin",
    params: z.object({ key: z.string() }),
    result: z.string().nullable(),
  },
  ui_state_set: {
    tier: "admin",
    params: z.object({ key: z.string(), value: z.string() }),
    result: z.null(),
  },
  /**
   * Stores still sealed by Electron's `safeStorage`, which only the Electron
   * app can read and move over.
   */
  legacy_secret_stores: {
    tier: "admin",
    params: NoParams,
    result: z.array(SecretStoreId),
  },
  reveal_in_finder: { tier: "host", params: HostPath, result: Void },
  open_path: { tier: "host", params: HostPath, result: Void },
  open_external_url: {
    tier: "host",
    params: z.object({ url: z.string() }),
    result: Void,
  },
  list_editors: {
    tier: "admin",
    params: NoParams,
    result: z.array(EditorDescriptor),
  },
  open_in_editor: {
    tier: "host",
    params: z.object({ editorId: z.string(), path: z.string() }),
    result: Void,
  },
  open_in_custom_editor: {
    tier: "host",
    params: z.object({ command: z.string(), path: z.string() }),
    result: Void,
  },
  get_enabled_tools: { tier: "admin", params: NoParams, result: EnabledTools },
  /** Unknown tool ids and non-boolean values are dropped by the host. */
  set_enabled_tools: {
    tier: "admin",
    params: z.object({
      userEnabled: z.record(z.string(), z.boolean().optional()).default({}),
    }),
    result: Void,
  },
  get_conductor_status: {
    tier: "admin",
    params: NoParams,
    result: ConductorStatus,
  },
  /** Published conductor versions >= the bundled one, newest first. */
  list_conductor_versions: {
    tier: "admin",
    params: NoParams,
    result: z.array(z.string()),
  },
  /** Pin a conductor version, or clear the pin with null. */
  set_conductor_version: {
    tier: "admin",
    params: z.object({ version: z.string().nullish() }),
    result: ConductorStatus,
  },
  get_app_version: { tier: "admin", params: NoParams, result: z.string() },
  telemetry_get_init: {
    tier: "admin",
    params: NoParams,
    result: TelemetryInit,
  },
  telemetry_set_mode: {
    tier: "admin",
    params: z.object({ mode: TelemetryMode }),
    result: Void,
  },
  telemetry_capture: {
    tier: "admin",
    params: z.object({
      event: z.string(),
      props: TelemetryProps.optional(),
    }),
    result: Void,
  },
  telemetry_capture_exception: {
    tier: "admin",
    params: z.object({
      message: z.string().optional(),
      stack: z.string().optional(),
      props: TelemetryProps.optional(),
    }),
    result: Void,
  },
  telemetry_capture_feedback: {
    tier: "admin",
    params: z.object({ message: z.string().optional() }),
    result: Void,
  },
} as const satisfies Record<string, CommandSpec>;
