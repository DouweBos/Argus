/**
 * Tool identity — the part of the tool system the host needs.
 *
 * Tools gate IPC handlers and UI surfaces behind one registry. The host only
 * ever deals in ids and the project-level mask; the renderer's `ToolManifest`
 * (icons, rail contributions, settings sections) stays in `app/tools/types.ts`
 * and imports these from here.
 */

/**
 * Closed union of every tool id Argus ships. Adding a tool = adding an entry
 * here AND a manifest in `app/tools/registry.ts`. We never load arbitrary
 * code, so the union stays exhaustive.
 */
export type ToolId =
  | "device-control"
  | "device-debug"
  | "device-inspector"
  | "device-recording";

export const TOOL_IDS: readonly ToolId[] = [
  "device-control",
  "device-debug",
  "device-inspector",
  "device-recording",
] as const;

/**
 * Project-level mask read from `.argus.json`. A project can disable tools for
 * everyone working on it but cannot force-enable a tool the user turned off.
 */
export interface ProjectToolConfig {
  disabled?: ToolId[];
}
