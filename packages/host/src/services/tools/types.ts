/**
 * Tool identity — the part of the tool system the host needs.
 *
 * Tools gate IPC handlers and UI surfaces behind one registry. The host only
 * ever deals in ids and the project-level mask; the renderer's `ToolManifest`
 * (icons, rail contributions, settings sections) stays in `app/tools/types.ts`
 * and imports these from here.
 */

import type { ToolId } from "@argus/remote-protocol";

export { TOOL_IDS, type ToolId } from "@argus/remote-protocol";

/**
 * Project-level mask read from `.argus.json`. A project can disable tools for
 * everyone working on it but cannot force-enable a tool the user turned off.
 */
export interface ProjectToolConfig {
  disabled?: ToolId[];
}
