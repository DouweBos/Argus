import type { DebugToolDef } from "./types";

/**
 * Registered debug tools. Order controls the tab order in the panel.
 *
 * To add a new tool, append a definition here. Stream tools pipe
 * conductor stdout into the log view; oneshot tools run once (with an
 * optional repeat interval).
 */
export const DEBUG_TOOLS: DebugToolDef[] = [
  {
    id: "logs",
    label: "Logs",
    description: "Stream app console and device logs in real time.",
    kind: "stream",
    buildArgs: () => ["logs", "--json"],
  },
];
