/**
 * Plugin system types.
 *
 * Plugins are first-party-only opt-in features that gate UI surfaces (toolrail
 * entries, runtime modes, settings sections) and IPC handlers behind a single
 * registry. The user picks which plugins they want during onboarding (and can
 * change later in Settings); each plugin's host-machine prerequisites and
 * downloadable assets are declared on its manifest.
 *
 * See `plan/extensible-plugin-system.md` for the architecture and
 * `plan/extensible-plugin-system-implementation.md` for the build sequence.
 */

import type { PrereqId } from "../lib/types";
import type { ReactNode, SVGProps } from "react";

/**
 * Closed union of every plugin id Argus ships. Adding a plugin = adding an
 * entry here AND a manifest in `registry.ts`. We never load arbitrary code,
 * so the union stays exhaustive.
 */
export type PluginId =
  | "device-control"
  | "device-debug"
  | "device-inspector"
  | "device-recording";

export const PLUGIN_IDS: readonly PluginId[] = [
  "device-control",
  "device-debug",
  "device-inspector",
  "device-recording",
] as const;

/**
 * Theme grouping used to render section headers in Settings → Plugins and the
 * onboarding picker. Closed union — add a new value here when shipping the
 * first plugin in a new theme.
 */
export type PluginGroup = "Agent" | "Device" | "Git" | "Misc";

/** Where a plugin-contributed toolrail entry sits. */
export type ToolPlacement = "bottom" | "right";

/** Icon component shape compatible with `@argus/peacock` icons. */
export type IconComponent = React.ComponentType<
  SVGProps<SVGSVGElement> & { size?: number }
>;

/**
 * One toolrail entry contributed by a plugin. The renderer merges these with
 * the static-core entries (`changes`, `terminal`, `notifications`). Panel
 * content is still rendered by `ToolPanel`'s switch — contributions carry
 * the rail-button metadata only, since the existing tool components consume
 * `sessionId` and other context that's awkward to thread through a render
 * callback.
 */
export interface ToolRailContribution {
  icon: IconComponent;
  /** Stable id; matches a `ToolId` member in `app/stores/layoutStore.ts`. */
  id: string;
  label: string;
  placement: ToolPlacement;
}

/**
 * One segment in the RuntimeView mode picker (e.g. `Inspect`). `Simulate` is
 * core and never contributed.
 */
export interface RuntimeModeContribution {
  /** Mode id. Becomes the value in the runtime-mode segmented control. */
  id: string;
  label: string;
  /** Optional overlay rendered when this mode is active. */
  render: () => ReactNode;
}

/**
 * One Settings dialog section contributed by a plugin (e.g. a future "default
 * capture FPS" control on `device-recording`). v1 plugins do not use this —
 * it's here so future plugins can extend Settings without editing the dialog.
 */
export interface SettingsSectionContribution {
  description?: string;
  icon?: ReactNode;
  id: string;
  label: string;
  render: () => ReactNode;
}

/**
 * Asset descriptor. Versions live with the app — never on the manifest. The
 * resolver derives URLs from `app.getVersion()` and the running platform/arch.
 */
export type PluginAsset =
  | {
      executable: true;
      kind: "native";
      /** File name inside the plugin's user-data dir (e.g. `argus-sim-bridge`). */
      name: string;
    }
  | {
      kind: "node";
      /** Tarball name without the `.tgz` suffix; expanded into the plugin dir. */
      name: string;
    }
  | { kind: "data"; name: string }
  | { kind: "jar"; name: string };

export interface PluginContributions {
  /**
   * Logical IPC group name. Backend handlers gate themselves on this id via
   * `pluginEnabled(<group>)`. Convention: same string as the plugin id.
   */
  ipcGroup?: PluginId;
  runtimeMode?: RuntimeModeContribution[];
  settingsSection?: SettingsSectionContribution[];
  toolRail?: ToolRailContribution[];
}

export interface PluginManifest {
  /** Downloadable assets fetched from the GH release for the running app version. */
  assets?: PluginAsset[];
  /** When true, assets are also packaged into `extraResources` (default: true today, false after the flip). */
  bundled?: boolean;
  contributes?: PluginContributions;
  /**
   * Initial enabled state for fresh installs. v1 plugins ship `false` after
   * the chunk-12 flip; until then they ship `true` to preserve current
   * behavior while the plumbing lands.
   */
  defaultEnabled: boolean;
  /** One-sentence summary shown in Settings → Plugins and the onboarding picker. */
  description: string;
  group: PluginGroup;
  /** Hidden plugins don't show in the picker — useful for in-development tools. */
  hidden?: boolean;
  id: PluginId;
  /** When true, assets are downloaded on first enable. (default: false today, true after the flip). */
  lazy?: boolean;
  name: string;
  /** Host-machine prereqs the user needs before this plugin works. */
  prereqs?: PrereqId[];
  /** Plugins required for this one to function. Disabling a base disables dependents. */
  requires?: PluginId[];
}

/**
 * Project-level mask read from `.argus.json`. A project can disable plugins
 * for everyone working on it but cannot force-enable a plugin the user has
 * turned off.
 */
export interface ProjectPluginConfig {
  disabled?: PluginId[];
}
