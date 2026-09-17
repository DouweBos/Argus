/**
 * Tool system types.
 *
 * Tools are first-party-only opt-in features that gate UI surfaces (toolrail
 * entries, runtime modes, settings sections) and IPC handlers behind a single
 * registry. The user picks which tools they want during onboarding (and can
 * change later in Settings); each tool's host-machine prerequisites are
 * declared on its manifest.
 */

import type { PrereqId } from "../lib/types";
import type { ToolId } from "@argus/host/services/tools/types";
import type { ReactNode, SVGProps } from "react";

// Tool ids and the project mask are owned by `@argus/host` — the host gates
// IPC handlers on them and cannot import renderer types.
export type {
  ProjectToolConfig,
  ToolId,
} from "@argus/host/services/tools/types";
export { TOOL_IDS } from "@argus/host/services/tools/types";

/**
 * Theme grouping used to render section headers in Settings → Tools and the
 * onboarding picker. Closed union — add a new value here when shipping the
 * first tool in a new theme.
 */
export type ToolGroup = "Agent" | "Device" | "Git" | "Misc";

/** Where a tool-contributed toolrail entry sits. */
export type ToolPlacement = "bottom" | "right";

/** Icon component shape compatible with `@argus/peacock` icons. */
export type IconComponent = React.ComponentType<
  SVGProps<SVGSVGElement> & { size?: number }
>;

/**
 * One toolrail entry contributed by a tool. The renderer merges these with
 * the static-core entries (`changes`, `terminal`, `notifications`). Panel
 * content is still rendered by `ToolPanel`'s switch — contributions carry
 * the rail-button metadata only, since the existing tool components consume
 * `sessionId` and other context that's awkward to thread through a render
 * callback.
 */
export interface ToolRailContribution {
  icon: IconComponent;
  /** Stable id; matches a `ToolRailId` member in `app/stores/layoutStore.ts`. */
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
 * One Settings dialog section contributed by a tool (e.g. a future "default
 * capture FPS" control on `device-recording`). v1 tools do not use this —
 * it's here so future tools can extend Settings without editing the dialog.
 */
export interface SettingsSectionContribution {
  description?: string;
  icon?: ReactNode;
  id: string;
  label: string;
  render: () => ReactNode;
}

export interface ToolContributions {
  /**
   * Logical IPC group name. Backend handlers gate themselves on this id via
   * `toolEnabled(<group>)`. Convention: same string as the tool id.
   */
  ipcGroup?: ToolId;
  runtimeMode?: RuntimeModeContribution[];
  settingsSection?: SettingsSectionContribution[];
  toolRail?: ToolRailContribution[];
}

export interface ToolManifest {
  contributes?: ToolContributions;
  /** Initial enabled state for fresh installs. */
  defaultEnabled: boolean;
  /** One-sentence summary shown in Settings → Tools and the onboarding picker. */
  description: string;
  group: ToolGroup;
  /** Hidden tools don't show in the picker — useful for in-development tools. */
  hidden?: boolean;
  id: ToolId;
  name: string;
  /** Host-machine prereqs the user needs before this tool works. */
  prereqs?: PrereqId[];
  /** Tools required for this one to function. Disabling a base disables dependents. */
  requires?: ToolId[];
}
