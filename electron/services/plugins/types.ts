/**
 * Re-export of the renderer-side plugin types for the main process.
 *
 * The shared types live in `app/plugins/types.ts` (renderer is the consumer
 * with the most plugin code). The dependency direction is:
 *   electron → app/plugins/types
 * which mirrors how `electron/services/session/models.ts` is imported by both
 * sides today.
 */

export type {
  PluginId,
  PluginManifest,
  ProjectPluginConfig,
} from "../../../app/plugins/types";

export { PLUGIN_IDS } from "../../../app/plugins/types";
