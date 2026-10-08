/**
 * Which sourcekit-lsp a Swift file gets: one per Swift package, rooted at it;
 * one for an Xcode project, through xcode-build-server once the app has been
 * built; single-file mode for a lone file. Anything else would show false
 * errors, so it doesn't start.
 */

import type { GateResult, Route } from "../route";
import path from "node:path";
import { loadArgusConfig } from "../../session/argusConfig";
import {
  CONFIG_FILE,
  configureBuildServer,
  excludeFromGit,
  findXcodeBuildServer,
  hasBuildLog,
  logManifest,
  readBuildServerConfig,
} from "./buildServer";
import { classifySwiftFile } from "./classify";
import {
  appSchemesIn,
  forgetSchemes,
  listSchemes,
  pickScheme,
  runCommandDerivedData,
  runCommandSchemes,
} from "./schemes";

type Shut = Extract<GateResult, { ok: false }>;

const INSTALL_MESSAGE =
  "Swift in Xcode projects needs xcode-build-server to know the SDK, modules and targets; without it sourcekit-lsp reports false errors. Install it with `brew install xcode-build-server`, then click Retry.";
const LOOSE_MESSAGE =
  "These Swift files aren't part of a Swift package or Xcode project, so sourcekit-lsp can't tell how they fit together.";

/** Roots whose scheme Argus picked among several, to say so. */
const guessed = new Set<string>();

const shut = (result: Shut) => async (): Promise<GateResult> => result;

function runCommands(root: string): { command: string; cwd: string }[] {
  try {
    return loadArgusConfig(root).run.map((r) => ({
      command: r.command,
      cwd: path.resolve(root, r.cwd ?? "."),
    }));
  } catch {
    return [];
  }
}

/** Generate `buildServer.json` for the project; why not, when that fails. */
async function configure(
  bin: string,
  root: string,
  container: string,
): Promise<Shut | null> {
  const commands = runCommands(root);
  const choice = pickScheme({
    schemes: await listSchemes(container),
    appSchemes: appSchemesIn(container),
    runSchemes: runCommandSchemes(commands.map((c) => c.command)),
    containerName: path.basename(container, path.extname(container)),
  });
  if (!choice) {
    return {
      ok: false,
      reason: "no_build_server",
      message: `Argus couldn't list the schemes of ${path.basename(container)}, so it can't set up xcode-build-server. Check that it opens in Xcode, then click Retry.`,
    };
  }
  try {
    await configureBuildServer({
      bin,
      root,
      container,
      scheme: choice.scheme,
      buildRoot: runCommandDerivedData(commands),
    });
    await excludeFromGit(root, CONFIG_FILE).catch(() => undefined);
    if (choice.guessed) {
      guessed.add(root);
    }
  } catch (err) {
    return {
      ok: false,
      reason: "no_build_server",
      message: `xcode-build-server couldn't be set up for scheme “${choice.scheme}”: ${String(err).slice(0, 200)}`,
    };
  }

  return null;
}

/** Shut until xcode-build-server is set up and has a build log to read. */
async function xcodeGate(root: string, container: string): Promise<GateResult> {
  let config = readBuildServerConfig(root);
  if (!config) {
    const bin = findXcodeBuildServer();
    if (!bin) {
      return {
        ok: false,
        reason: "no_build_server",
        action: "install_build_server",
        message: INSTALL_MESSAGE,
      };
    }
    const failed = await configure(bin, root, container);
    if (failed) {
      return failed;
    }
    config = readBuildServerConfig(root);
  }
  if (config === "other" || !config || config.kind !== "xcode") {
    return { ok: true, message: "Swift intelligence from your build server" };
  }
  const scheme = config.scheme ? `scheme “${config.scheme}”` : "latest build";
  const note = guessed.has(root)
    ? " Argus picked this scheme among several: name another with -scheme in an xcodebuild run command, delete buildServer.json and click Retry to switch."
    : "";
  if (
    config.build_root &&
    !(await hasBuildLog(config.build_root, config.scheme))
  ) {
    return {
      ok: false,
      reason: "not_built",
      action: "build_once",
      message: `Build the app once in this session to enable Swift intelligence — with its run command or in Xcode (${scheme}).${note}`,
      watch: logManifest(config.build_root),
    };
  }

  return {
    ok: true,
    message: `Swift intelligence from xcode-build-server, using the ${scheme}. Build again after adding files or changing settings.${note}`,
  };
}

/** A build server is or can be set up, so the project covers its packages too. */
function buildServerUsable(root: string): boolean {
  return (
    readBuildServerConfig(root) !== null || findXcodeBuildServer() !== null
  );
}

export function swiftRoute(sessionRoot: string, file: string): Route {
  const context = classifySwiftFile(sessionRoot, file, {
    xcodeHandlesPackages: buildServerUsable(sessionRoot),
  });
  switch (context.kind) {
    case "swiftpm":
      return { root: context.root, scope: "swiftpm", project: "swiftpm" };
    case "xcode":
      return {
        root: context.root,
        scope: "xcode",
        project: "xcode",
        gate: () => xcodeGate(context.root, context.container),
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

/** A retry looks at the project's schemes again. */
export function forgetSwiftContext(): void {
  forgetSchemes();
}
