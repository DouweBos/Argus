/**
 * Shared types for the Debug toolrail panel.
 *
 * A "debug tool" is a focused diagnostic surface that talks to conductor
 * against a specific device. Two kinds are supported:
 *
 * - **stream** — spawns a long-lived conductor subprocess (e.g. `logs`)
 *   whose stdout is forwarded to the renderer as it arrives.
 * - **oneshot** — runs a single conductor invocation and returns its output.
 *   The panel offers an optional polling interval so the UI can refresh
 *   the sample at a cadence (e.g. `memory` every 2s).
 *
 * Add a new debug tool by appending a definition to `registry.ts`. No other
 * wiring is needed.
 */

export type DebugToolKind = "oneshot" | "stream";

interface DebugToolBase {
  /**
   * Produce the conductor argv for this tool (without `--device`, which the
   * backend adds automatically).
   */
  buildArgs: () => string[];
  /** Short description shown under the header. */
  description: string;
  /** Stable identifier; used in stream-id keys and as a React key. */
  id: string;
  kind: DebugToolKind;
  /** Human label for the tab. */
  label: string;
}

export interface StreamDebugTool extends DebugToolBase {
  kind: "stream";
}

export interface OneshotDebugTool extends DebugToolBase {
  /** Default polling interval when the user enables "repeat". Milliseconds. */
  defaultIntervalMs: number;
  kind: "oneshot";
}

export type DebugToolDef = OneshotDebugTool | StreamDebugTool;
