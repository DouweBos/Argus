/**
 * Which sourcekit-lsp a Swift file gets: one per Swift package, rooted at it;
 * one for an Xcode project, held back until it can see the build settings;
 * single-file mode for a lone file. Anything else would show false errors.
 */

import type { GateResult, Route } from "../route";
import { classifySwiftFile } from "./classify";

const XCODE_MESSAGE =
  "Swift in Xcode projects needs a build server to know the SDK, modules and targets. Without one, sourcekit-lsp reports false errors, so Argus doesn't start it.";
const LOOSE_MESSAGE =
  "These Swift files aren't part of a Swift package or Xcode project, so sourcekit-lsp can't tell how they fit together.";

const shut =
  (result: Extract<GateResult, { ok: false }>) =>
  async (): Promise<GateResult> =>
    result;

export function swiftRoute(sessionRoot: string, file: string): Route {
  const context = classifySwiftFile(sessionRoot, file);
  switch (context.kind) {
    case "swiftpm":
      return { root: context.root, scope: "swiftpm", project: "swiftpm" };
    case "xcode":
      return {
        root: context.root,
        scope: "xcode",
        project: "xcode",
        gate: shut({
          ok: false,
          reason: "no_build_server",
          action: "install_build_server",
          message: XCODE_MESSAGE,
        }),
      };
    case "loose":
      return { root: context.root, scope: "files", project: "files" };
    case "loose_group":
      return {
        root: context.root,
        scope: "files",
        project: "files",
        gate: shut({
          ok: false,
          reason: "loose_files",
          message: LOOSE_MESSAGE,
        }),
      };
  }
}
