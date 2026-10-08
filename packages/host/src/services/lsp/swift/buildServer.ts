/**
 * xcode-build-server (github.com/SolaWing/xcode-build-server): a Build Server
 * Protocol server sourcekit-lsp starts from `buildServer.json` at its root.
 * It reads compile flags from the project's Xcode build logs, so it only
 * helps once the scheme has been built for this worktree.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { findOnPath } from "../servers";

const run = promisify(execFile);

export const CONFIG_FILE = "buildServer.json";
const HOMEBREW_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"];

let override: string | null | undefined;

/** On the login-shell PATH, else where Homebrew puts it. */
export function findXcodeBuildServer(): string | null {
  if (override !== undefined) {
    return override;
  }
  const onPath = findOnPath("xcode-build-server");
  if (onPath) {
    return onPath;
  }
  for (const dir of HOMEBREW_DIRS) {
    const file = path.join(dir, "xcode-build-server");
    try {
      fs.accessSync(file, fs.constants.X_OK);

      return file;
    } catch {
      // Not here.
    }
  }

  return null;
}

/** Pretend it is (a path) or isn't (null) installed; undefined looks again. */
export function setXcodeBuildServerForTest(bin: string | null | undefined) {
  override = bin;
}

export interface BuildServerConfig {
  /** xcode-build-server's: `xcode` follows build logs, `manual` a parsed log. */
  kind?: string;
  build_root?: string;
  scheme?: string;
  argv?: string[];
}

/**
 * The BSP config sourcekit-lsp would pick up at `root`: `buildServer.json`,
 * or anything in `.bsp/` (another build server — trusted as is).
 */
export function readBuildServerConfig(
  root: string,
): BuildServerConfig | "other" | null {
  try {
    const raw = fs.readFileSync(path.join(root, CONFIG_FILE), "utf8");

    return JSON.parse(raw) as BuildServerConfig;
  } catch {
    // Absent or unreadable: look for a `.bsp` connection file instead.
  }
  try {
    return fs
      .readdirSync(path.join(root, ".bsp"))
      .some((n) => n.endsWith(".json"))
      ? "other"
      : null;
  } catch {
    return null;
  }
}

/** Xcode records every build of a DerivedData folder here. */
export function logManifest(buildRoot: string): string {
  return path.join(buildRoot, "Logs/Build/LogStoreManifest.plist");
}

/** Whether `scheme` (any scheme when unset) has a build log to read flags from. */
export async function hasBuildLog(
  buildRoot: string,
  scheme?: string,
): Promise<boolean> {
  const manifest = logManifest(buildRoot);
  if (!fs.existsSync(manifest)) {
    return false;
  }
  try {
    const { stdout } = await run(
      "plutil",
      ["-convert", "json", "-o", "-", manifest],
      { timeout: 10_000, maxBuffer: 16 << 20 },
    );
    const logs = Object.values(
      (JSON.parse(stdout) as { logs?: Record<string, Record<string, unknown>> })
        .logs ?? {},
    );

    return logs.some(
      (log) => !scheme || log["schemeIdentifier-schemeName"] === scheme,
    );
  } catch {
    return false;
  }
}

/**
 * Write `buildServer.json` at `root` for `container` and `scheme`. Without
 * `buildRoot` it asks `xcodebuild -showBuildSettings` for the DerivedData
 * folder, which takes a few seconds.
 */
export async function configureBuildServer(options: {
  bin: string;
  root: string;
  container: string;
  scheme: string;
  buildRoot?: string | null;
}): Promise<void> {
  const { bin, root, container, scheme, buildRoot } = options;
  const flag = container.endsWith(".xcworkspace") ? "-workspace" : "-project";
  await run(
    bin,
    [
      "config",
      flag,
      path.relative(root, container),
      "-scheme",
      scheme,
      ...(buildRoot ? ["--build_root", buildRoot] : []),
    ],
    { cwd: root, timeout: 120_000 },
  );
}

/** Keep the generated file out of `git status`, without touching `.gitignore`. */
export async function excludeFromGit(root: string, name: string) {
  const { stdout } = await run(
    "git",
    ["rev-parse", "--git-path", "info/exclude"],
    { cwd: root, timeout: 10_000 },
  );
  const exclude = path.resolve(root, stdout.trim());
  const line = `/${name}`;
  let current = "";
  try {
    current = await fs.promises.readFile(exclude, "utf8");
  } catch {
    // No exclude file yet.
  }
  if (current.split("\n").includes(line)) {
    return;
  }
  await fs.promises.mkdir(path.dirname(exclude), { recursive: true });
  const separator = current && !current.endsWith("\n") ? "\n" : "";
  await fs.promises.appendFile(exclude, `${separator}${line}\n`);
}
