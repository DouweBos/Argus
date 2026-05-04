/**
 * Re-export of the renderer-side tool types for the main process.
 *
 * The shared types live in `app/tools/types.ts` (renderer is the consumer
 * with the most tool code). The dependency direction is:
 *   electron → app/tools/types
 * which mirrors how `electron/services/session/models.ts` is imported by both
 * sides today.
 */

export type {
  ToolId,
  ToolManifest,
  ProjectToolConfig,
} from "../../../app/tools/types";

export { TOOL_IDS } from "../../../app/tools/types";
