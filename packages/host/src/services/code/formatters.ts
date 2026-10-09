/**
 * Which of the project's own formatters covers a file, and how to run it on
 * stdin. A formatter only counts when the project clearly uses it (a config
 * file, or the dependency); nothing is ever installed or downloaded.
 */

import type { CodeFormatter } from "@argus/remote-protocol";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { findOnPath } from "../lsp/servers";

export interface FormatterRun {
  formatter: Exclude<CodeFormatter, "none">;
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

/** The project uses it but it can't run here: said to the user, never a silent skip. */
export interface FormatterMissing {
  formatter: Exclude<CodeFormatter, "none">;
  missing: string;
}

export type FormatterResolution = FormatterMissing | FormatterRun | null;

const PRETTIER_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".json",
  ".jsonc",
  ".json5",
  ".css",
  ".scss",
  ".less",
  ".html",
  ".htm",
  ".vue",
  ".md",
  ".markdown",
  ".mdx",
  ".yaml",
  ".yml",
  ".graphql",
  ".gql",
]);

const PRETTIER_CONFIGS = [
  ".prettierrc",
  ...[
    "json",
    "yaml",
    "yml",
    "json5",
    "toml",
    "js",
    "cjs",
    "mjs",
    "ts",
    "cts",
    "mts",
  ].map((ext) => `.prettierrc.${ext}`),
  ...["js", "cjs", "mjs", "ts", "cts", "mts"].map(
    (ext) => `prettier.config.${ext}`,
  ),
];

/** Homebrew's prefixes, for a host whose PATH missed the login shell's. */
const EXTRA_BIN_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"];

/** `file`'s directory, then each parent up to and including `root`. */
export function directoriesUp(root: string, file: string): string[] {
  const dirs: string[] = [];
  let dir = path.dirname(file);
  for (;;) {
    dirs.push(dir);
    if (dir === root) {
      return dirs;
    }
    const parent = path.dirname(dir);
    if (parent === dir || !(dir + path.sep).startsWith(root + path.sep)) {
      return dirs;
    }
    dir = parent;
  }
}

function exists(file: string): boolean {
  return fs.existsSync(file);
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));

    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function firstDir(dirs: string[], names: string[]): string | null {
  return (
    dirs.find((dir) => names.some((n) => exists(path.join(dir, n)))) ?? null
  );
}

function findBinary(name: string): string | null {
  const onPath = findOnPath(name);
  if (onPath) {
    return onPath;
  }
  for (const dir of EXTRA_BIN_DIRS) {
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);

      return candidate;
    } catch {
      // Not there.
    }
  }

  return null;
}

const xcrunCache = new Map<string, Promise<string | null>>();

function xcrunFind(tool: string): Promise<string | null> {
  if (process.platform !== "darwin") {
    return Promise.resolve(null);
  }
  let found = xcrunCache.get(tool);
  if (!found) {
    found = new Promise((resolve) => {
      execFile("xcrun", ["--find", tool], { timeout: 10_000 }, (err, out) => {
        const hit = out?.trim();
        resolve(!err && hit && exists(hit) ? hit : null);
      });
    });
    xcrunCache.set(tool, found);
  }

  return found;
}

// MARK: Prettier

function dependsOn(pkg: Record<string, unknown>, name: string): boolean {
  return ["dependencies", "devDependencies"].some((key) => {
    const deps = pkg[key];

    return !!deps && typeof deps === "object" && name in deps;
  });
}

/** A config file, a `"prettier"` key, or prettier in the nearest package's dependencies. */
function prettierConfigDir(dirs: string[]): string | null {
  let nearestPackage = true;
  for (const dir of dirs) {
    if (PRETTIER_CONFIGS.some((name) => exists(path.join(dir, name)))) {
      return dir;
    }
    const pkg = readJson(path.join(dir, "package.json"));
    if (pkg) {
      if ("prettier" in pkg || (nearestPackage && dependsOn(pkg, "prettier"))) {
        return dir;
      }
      nearestPackage = false;
    }
  }

  return null;
}

/** The worktree's own prettier: its package's `bin`, run on the host's Node. */
function prettierBin(dirs: string[]): string | null {
  for (const dir of dirs) {
    const pkgDir = path.join(dir, "node_modules", "prettier");
    const pkg = readJson(path.join(pkgDir, "package.json"));
    if (!pkg) {
      continue;
    }
    const bin =
      typeof pkg.bin === "string"
        ? pkg.bin
        : (pkg.bin as Record<string, string> | undefined)?.prettier;
    if (bin && exists(path.join(pkgDir, bin))) {
      return fs.realpathSync(path.join(pkgDir, bin));
    }
  }

  return null;
}

function resolvePrettier(dirs: string[], file: string): FormatterResolution {
  const configDir = prettierConfigDir(dirs);
  if (!configDir) {
    return null;
  }
  const bin = prettierBin(dirs);
  if (!bin) {
    return {
      formatter: "prettier",
      missing:
        "The project uses Prettier but it isn't installed in this worktree. Install its dependencies.",
    };
  }
  // Prettier reads `.prettierignore` (and `.gitignore`) from its working directory.
  const cwd = firstDir(dirs, [".prettierignore"]) ?? configDir;

  return {
    formatter: "prettier",
    command: process.execPath,
    args: [bin, "--stdin-filepath", path.relative(cwd, file)],
    cwd,
    env: { ELECTRON_RUN_AS_NODE: "1", NO_COLOR: "1", FORCE_COLOR: "0" },
  };
}

// MARK: Swift

async function resolveSwift(
  dirs: string[],
  file: string,
): Promise<FormatterResolution> {
  const swiftformat = firstDir(dirs, [".swiftformat"]);
  const swiftFormat = firstDir(dirs, [".swift-format"]);
  // Both configured: the nearer one wins.
  const useSwiftformat =
    swiftformat !== null &&
    (swiftFormat === null || swiftformat.length >= swiftFormat.length);
  if (useSwiftformat) {
    const bin = findBinary("swiftformat");

    return bin
      ? {
          formatter: "swiftformat",
          command: bin,
          args: ["stdin", "--stdinpath", file, "--quiet"],
          cwd: swiftformat,
        }
      : {
          formatter: "swiftformat",
          missing:
            "The project has a .swiftformat file but SwiftFormat isn't installed (brew install swiftformat).",
        };
  }
  if (swiftFormat !== null) {
    const bin = findBinary("swift-format") ?? (await xcrunFind("swift-format"));

    return bin
      ? {
          formatter: "swift-format",
          command: bin,
          args: ["format", "--assume-filename", file],
          cwd: swiftFormat,
        }
      : {
          formatter: "swift-format",
          missing:
            "The project has a .swift-format file but swift-format isn't installed (it ships with Xcode 16).",
        };
  }

  return null;
}

// MARK: Others

function pyprojectHas(dirs: string[], table: string): string | null {
  for (const dir of dirs) {
    try {
      const text = fs.readFileSync(path.join(dir, "pyproject.toml"), "utf8");
      if (text.includes(`[tool.${table}`)) {
        return dir;
      }
    } catch {
      // No pyproject here.
    }
  }

  return null;
}

function resolveOther(dirs: string[], file: string): FormatterResolution {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".go") {
    const dir = firstDir(dirs, ["go.mod"]);
    const bin = dir ? findBinary("gofmt") : null;

    return dir && bin
      ? { formatter: "gofmt", command: bin, args: [], cwd: dir }
      : null;
  }
  if (ext === ".py" || ext === ".pyi") {
    const ruff =
      firstDir(dirs, ["ruff.toml", ".ruff.toml"]) ?? pyprojectHas(dirs, "ruff");
    const ruffBin = ruff ? findBinary("ruff") : null;
    if (ruff && ruffBin) {
      return {
        formatter: "ruff",
        command: ruffBin,
        args: ["format", "--stdin-filename", file, "-"],
        cwd: ruff,
      };
    }
    const black = pyprojectHas(dirs, "black");
    const blackBin = black ? findBinary("black") : null;
    if (black && blackBin) {
      return {
        formatter: "black",
        command: blackBin,
        args: ["-q", "--stdin-filename", file, "-"],
        cwd: black,
      };
    }
  }

  return null;
}

/** The formatter for `file` (absolute, inside `root`), or null when the project has none for it. */
export async function resolveFormatter(
  root: string,
  file: string,
): Promise<FormatterResolution> {
  const dirs = directoriesUp(root, file);
  const ext = path.extname(file).toLowerCase();
  if (PRETTIER_EXTENSIONS.has(ext)) {
    return resolvePrettier(dirs, file);
  }
  if (ext === ".swift") {
    return resolveSwift(dirs, file);
  }

  return resolveOther(dirs, file);
}
