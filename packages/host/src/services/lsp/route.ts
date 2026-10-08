/**
 * Where a document's server runs, and what must hold before it starts. Most
 * languages get one server at the session root; Swift picks per file.
 */

import type { LspSetupAction } from "@argus/remote-protocol";

/** What kind of Swift project a server runs against (telemetry). */
export type LspProject = "files" | "swiftpm" | "xcode";

/** Whether a server may start: some can't answer honestly until set up. */
export type GateResult =
  | {
      ok: false;
      message: string;
      reason: "loose_files" | "no_build_server" | "not_built";
      action?: LspSetupAction;
      /** A file whose change is worth checking the gate again for. */
      watch?: string;
    }
  | { ok: true; message?: string };

/** Where a document's server runs, and what has to hold before it starts. */
export interface Route {
  root: string;
  /** Tells apart servers sharing a root (a Swift package vs loose files). */
  scope?: string;
  project?: LspProject;
  gate?: () => Promise<GateResult>;
}
