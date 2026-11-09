/**
 * The shape of one entry in the command catalog — the single source of truth
 * for every host command's params, result and tier. The host registers
 * handlers against it, the renderer types its wrappers from it, and the Swift
 * client's types are generated from it.
 */

import { z } from "zod";

/**
 * How far a command may travel.
 * - "host": never crosses the wire. Acts on the machine the *window* is on, or
 *   mutates the trust store that authorises the wire itself.
 * - "monitor" / "control": the narrow tiers the phone and web clients hold.
 *   Raw commands are not on those clients' surface (they speak the dotted
 *   `REMOTE_METHODS` allowlist), so nothing carries them today.
 * - "admin": reachable by a paired Mac driving this host as if sitting at its
 *   keyboard. The default for anything that is not window- or trust-scoped.
 */
export type CommandTier = "admin" | "control" | "host" | "monitor";

/**
 * Closed union of every tool id Argus ships. Adding a tool = adding an entry
 * here AND one in ArgusCore's `DesktopTool.all`.
 */
export const TOOL_IDS = [
  "device-control",
  "device-debug",
  "device-inspector",
  "device-recording",
] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export interface CommandSpec {
  tier: CommandTier;
  params: z.ZodType;
  result: z.ZodType;
  /** The handler only runs while this tool is enabled. */
  tool?: ToolId;
}

/** Params for a command that takes none. */
export const NoParams = z.object({});

/** Result for a command that resolves with nothing. */
export const Void = z.void();
