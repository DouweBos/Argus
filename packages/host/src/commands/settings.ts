import { hostPlatform } from "../platform";
import {
  loadAppSettings,
  saveAppSettings,
} from "../services/appSettings/store";
import { defineTypedCommand } from "../services/command/registry";
import {
  getConductorStatus,
  readBundledVersion,
  setConductorOverrideVersion,
} from "../services/conductor/override";
import { listConductorVersions } from "../services/conductor/registry";
import { checkDependencies } from "../services/dependencies/check";
import { findLegacySecretStores } from "../services/secrets/legacyStores";
import {
  listEditors,
  openInCustomEditor,
  openInEditor,
} from "../services/shell/editors";
import {
  openExternalUrl,
  openPath,
  revealInFinder,
} from "../services/shell/operations";
import {
  capture,
  captureClientException,
  captureFeedback,
  captureFromClient,
  getTelemetryInit,
  setTelemetryMode,
} from "../services/telemetry/telemetry";
import {
  getEnabledToolsForRenderer,
  setEnabledToolsFromRenderer,
} from "../services/tools/state";
import { getUiState, setUiState } from "../services/uiState";

export function registerSettingsCommands(): void {
  defineTypedCommand("get_app_settings", () => loadAppSettings());
  defineTypedCommand("set_app_settings", (p) => {
    const nextTheme = p.settings.color_theme;
    if (nextTheme && nextTheme !== loadAppSettings().color_theme) {
      capture("color_theme_changed", { theme: nextTheme });
    }

    return saveAppSettings(p.settings);
  });
  defineTypedCommand("check_dependencies", () => checkDependencies());
  defineTypedCommand("ui_state_get", (p) => getUiState(p.key));
  defineTypedCommand("ui_state_set", (p) => {
    setUiState(p.key, p.value);

    return null;
  });

  defineTypedCommand("legacy_secret_stores", () => findLegacySecretStores());

  defineTypedCommand("reveal_in_finder", (p) => revealInFinder(p.path));
  defineTypedCommand("open_path", (p) => openPath(p.path));
  defineTypedCommand("open_external_url", (p) => openExternalUrl(p.url));
  defineTypedCommand("list_editors", () => listEditors());
  defineTypedCommand("open_in_editor", (p) => openInEditor(p.editorId, p.path));
  defineTypedCommand("open_in_custom_editor", (p) =>
    openInCustomEditor(p.command, p.path),
  );

  defineTypedCommand("get_enabled_tools", () => getEnabledToolsForRenderer());
  defineTypedCommand("set_enabled_tools", (p) =>
    setEnabledToolsFromRenderer(p.userEnabled),
  );
  defineTypedCommand("get_conductor_status", () => getConductorStatus());
  defineTypedCommand("list_conductor_versions", () =>
    listConductorVersions(readBundledVersion()),
  );
  defineTypedCommand("set_conductor_version", (p) =>
    setConductorOverrideVersion(p.version ?? null),
  );

  defineTypedCommand("get_app_version", () => hostPlatform().appVersion());
  defineTypedCommand("telemetry_get_init", () => getTelemetryInit());
  defineTypedCommand("telemetry_set_mode", (p) => setTelemetryMode(p.mode));
  defineTypedCommand("telemetry_capture", (p) =>
    captureFromClient(p.event, p.props ?? {}),
  );
  defineTypedCommand("telemetry_capture_exception", (p) =>
    captureClientException(
      p.message ?? "renderer error",
      p.stack,
      p.props ?? {},
    ),
  );
  defineTypedCommand("telemetry_capture_feedback", (p) =>
    captureFeedback(p.message ?? ""),
  );
}
