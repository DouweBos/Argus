/**
 * Which scheme of an Xcode project the build server follows: the one the
 * session's run command builds, else the app scheme named after the project,
 * else the first app scheme, else the first scheme. Always deterministic.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface SchemeChoice {
  scheme: string;
  /** Picked among several without a run command to go by. */
  guessed: boolean;
}

const ARG = String.raw`(?:"([^"]+)"|'([^']+)'|(\S+))`;

function argValues(command: string, flag: string): string[] {
  const pattern = new RegExp(String.raw`(?:^|\s)${flag}[\s=]+${ARG}`, "g");

  return [...command.matchAll(pattern)].map((m) => m[1] ?? m[2] ?? m[3]);
}

/** `-scheme` values of the run commands that call `xcodebuild`. */
export function runCommandSchemes(commands: string[]): string[] {
  return commands
    .filter((c) => /\bxcodebuild\b/.test(c))
    .flatMap((c) => argValues(c, "-scheme"));
}

/** A run command's `-derivedDataPath`, absolute (relative ones from `cwd`). */
export function runCommandDerivedData(
  commands: { command: string; cwd: string }[],
): string | null {
  for (const { command, cwd } of commands) {
    if (!/\bxcodebuild\b/.test(command)) {
      continue;
    }
    const [value] = argValues(command, "-derivedDataPath");
    if (value && !value.includes("$")) {
      return path.resolve(cwd, value);
    }
  }

  return null;
}

export function pickScheme(options: {
  schemes: string[];
  appSchemes: string[];
  runSchemes: string[];
  containerName: string;
}): SchemeChoice | null {
  const { schemes, appSchemes, runSchemes, containerName } = options;
  const fromRun = runSchemes.find((s) => schemes.includes(s));
  if (fromRun) {
    return { scheme: fromRun, guessed: false };
  }
  const apps = schemes.filter((s) => appSchemes.includes(s));
  const pool = apps.length > 0 ? apps : schemes;
  const scheme = pool.find((s) => s === containerName) ?? pool[0];
  if (!scheme) {
    return null;
  }

  return { scheme, guessed: pool.length > 1 };
}

function sharedSchemeFiles(dir: string): string[] {
  const schemes = path.join(dir, "xcshareddata/xcschemes");
  try {
    return fs
      .readdirSync(schemes)
      .filter((n) => n.endsWith(".xcscheme"))
      .map((n) => path.join(schemes, n));
  } catch {
    return [];
  }
}

/** The projects a workspace lists, as absolute paths. */
function workspaceProjects(workspace: string): string[] {
  let data = "";
  try {
    data = fs.readFileSync(
      path.join(workspace, "contents.xcworkspacedata"),
      "utf8",
    );
  } catch {
    return [];
  }
  const base = path.dirname(workspace);

  return [...data.matchAll(/location\s*=\s*"(?:group|container):([^"]+)"/g)]
    .map((m) => m[1])
    .filter((p) => p.endsWith(".xcodeproj"))
    .map((p) => path.resolve(base, p));
}

/** Shared schemes that build an `.app`. */
export function appSchemesIn(container: string): string[] {
  const dirs = container.endsWith(".xcworkspace")
    ? [container, ...workspaceProjects(container)]
    : [container];

  return dirs.flatMap(sharedSchemeFiles).flatMap((file) => {
    try {
      const xml = fs.readFileSync(file, "utf8");

      return /BuildableName\s*=\s*"[^"]+\.app"/.test(xml)
        ? [path.basename(file, ".xcscheme")]
        : [];
    } catch {
      return [];
    }
  });
}

const listed = new Map<string, Promise<string[]>>();

/** `xcodebuild -list`, once per container until the next retry. */
export function listSchemes(container: string): Promise<string[]> {
  let found = listed.get(container);
  if (!found) {
    const flag = container.endsWith(".xcworkspace") ? "-workspace" : "-project";
    found = new Promise((resolve) => {
      execFile(
        "xcodebuild",
        ["-list", "-json", flag, container],
        { cwd: path.dirname(container), timeout: 60_000, maxBuffer: 8 << 20 },
        (_err, stdout) => {
          try {
            // SwiftPM can print before the JSON.
            const json = JSON.parse(stdout.slice(stdout.indexOf("{"))) as {
              workspace?: { schemes?: string[] };
              project?: { schemes?: string[] };
            };
            resolve((json.workspace ?? json.project)?.schemes ?? []);
          } catch {
            resolve([]);
          }
        },
      );
    });
    listed.set(container, found);
  }

  return found;
}

export function forgetSchemes(): void {
  listed.clear();
}
