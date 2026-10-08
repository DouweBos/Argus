/**
 * What a Swift file belongs to, which decides whether sourcekit-lsp can give
 * honest answers about it: a Swift package (it reads `Package.swift`), an
 * Xcode project (it needs a build server for the SDK, modules and targets),
 * or loose files (single-file mode, which only works for one file alone).
 */

import fs from "node:fs";
import path from "node:path";

/**
 * `loose`: a file alone in its directory, outside any package or project.
 * `loose_group`: several loose files in `root` that sourcekit-lsp can't relate.
 * `swiftpm`: `root` is the package directory. `xcode`: `root` is the session
 * root, `container` the nearest workspace or project.
 */
export type SwiftContext =
  | { kind: "loose_group"; root: string }
  | { kind: "loose"; root: string }
  | { kind: "swiftpm"; root: string }
  | { kind: "xcode"; root: string; container: string };

/** Never where a project's own containers or packages live. */
const SKIPPED_DIRS = new Set([
  ".build",
  ".git",
  ".swiftpm",
  "Carthage",
  "DerivedData",
  "Pods",
  "build",
  "node_modules",
]);
const SCAN_DEPTH = 3;
const SCAN_LIMIT = 2000;

const isContainer = (name: string) =>
  name.endsWith(".xcworkspace") || name.endsWith(".xcodeproj");

function readDir(dir: string): fs.Dirent[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/** A workspace beats a project in the same directory (CocoaPods makes both). */
function containerIn(dir: string): string | null {
  const names = readDir(dir)
    .filter((e) => e.isDirectory() && isContainer(e.name))
    .map((e) => e.name);
  const best =
    names.find((n) => n.endsWith(".xcworkspace")) ??
    names.find((n) => n.endsWith(".xcodeproj"));

  return best ? path.join(dir, best) : null;
}

/** Directories from `dir` up to and including `root`, nearest first. */
function upTo(dir: string, root: string): string[] {
  const dirs: string[] = [];
  let current = dir;
  while (current === root || current.startsWith(root + path.sep)) {
    dirs.push(current);
    if (current === root) {
      break;
    }
    current = path.dirname(current);
  }

  return dirs;
}

function inSkippedDir(dir: string, root: string): boolean {
  return path
    .relative(root, dir)
    .split(path.sep)
    .some((part) => SKIPPED_DIRS.has(part) || isContainer(part));
}

export function nearestPackage(dir: string, root: string): string | null {
  for (const candidate of upTo(dir, root)) {
    if (fs.existsSync(path.join(candidate, "Package.swift"))) {
      return candidate;
    }
  }

  return null;
}

/** Shallow, breadth-first: the first workspace or project under `root`. */
function scanForContainer(root: string): string | null {
  let level = [root];
  let seen = 0;
  for (let depth = 0; depth <= SCAN_DEPTH && level.length > 0; depth += 1) {
    const next: string[] = [];
    for (const dir of level) {
      const found = containerIn(dir);
      if (found) {
        return found;
      }
      for (const entry of readDir(dir)) {
        const skip =
          !entry.isDirectory() ||
          entry.name.startsWith(".") ||
          SKIPPED_DIRS.has(entry.name) ||
          isContainer(entry.name);
        if (!skip && (seen += 1) <= SCAN_LIMIT) {
          next.push(path.join(dir, entry.name));
        }
      }
    }
    level = next;
  }

  return null;
}

/** The workspace or project nearest above `dir`, else the first in `root`. */
export function findXcodeContainer(dir: string, root: string): string | null {
  for (const candidate of upTo(dir, root)) {
    const found = containerIn(candidate);
    if (found) {
      return found;
    }
  }

  return scanForContainer(root);
}

/**
 * A package that only lists iOS-family platforms. SwiftPM would still build
 * it for the Mac, where `import UIKit` fails — so in an app it's analysed with
 * the app.
 */
export function isMobileOnlyPackage(manifest: string): boolean {
  return (
    /\bplatforms\s*:/.test(manifest) &&
    /\.(iOS|tvOS|watchOS|visionOS|macCatalyst)\s*\(/.test(manifest) &&
    !/\.macOS\s*\(/.test(manifest)
  );
}

function readManifest(packageDir: string): string {
  try {
    return fs.readFileSync(path.join(packageDir, "Package.swift"), "utf8");
  } catch {
    return "";
  }
}

function hasSwiftSiblings(file: string): boolean {
  return readDir(path.dirname(file)).some(
    (e) =>
      e.isFile() && e.name.endsWith(".swift") && e.name !== path.basename(file),
  );
}

export interface ClassifyOptions {
  /** An Xcode project can be built for the server: it handles every file in it. */
  xcodeHandlesPackages?: boolean;
}

export function classifySwiftFile(
  root: string,
  file: string,
  options: ClassifyOptions = {},
): SwiftContext {
  const dir = path.dirname(file);
  const skipped = inSkippedDir(dir, root);
  const pkg = skipped ? null : nearestPackage(dir, root);
  const container = skipped ? null : findXcodeContainer(dir, root);
  if (
    pkg &&
    !(
      container &&
      (options.xcodeHandlesPackages || isMobileOnlyPackage(readManifest(pkg)))
    )
  ) {
    return { kind: "swiftpm", root: pkg };
  }
  if (container) {
    return { kind: "xcode", root, container };
  }

  return hasSwiftSiblings(file)
    ? { kind: "loose_group", root: dir }
    : { kind: "loose", root };
}
