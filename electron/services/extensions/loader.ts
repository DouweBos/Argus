/**
 * Scans ~/.cursor/extensions/ and ~/.vscode/extensions/ for installed
 * VS Code extensions and returns their manifests + file trees so the
 * renderer can register them with monaco-vscode-api.
 */

import fs from "fs";
import os from "os";
import path from "path";

export interface ExtensionFile {
  /** Path relative to the extension root (e.g. "client/out/extension.js") */
  relativePath: string;
  /** Absolute path on disk */
  absolutePath: string;
}

export interface DiscoveredExtension {
  /** Absolute path to the extension directory */
  extensionPath: string;
  /** Parsed package.json */
  manifest: Record<string, unknown>;
  /** All files in the extension directory (relative paths) */
  files: string[];
}

const EXTENSION_DIRS = [
  path.join(os.homedir(), ".cursor", "extensions"),
  path.join(os.homedir(), ".vscode", "extensions"),
];

/**
 * Discover all extensions from Cursor and VS Code extension directories.
 * Returns deduplicated by extension ID (publisher.name), preferring Cursor.
 */
export async function discoverExtensions(): Promise<DiscoveredExtension[]> {
  const seen = new Set<string>();
  const results: DiscoveredExtension[] = [];

  for (const extDir of EXTENSION_DIRS) {
    if (!fs.existsSync(extDir)) {
      continue;
    }

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(extDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const extPath = path.join(extDir, entry.name);
      const pkgPath = path.join(extPath, "package.json");

      if (!fs.existsSync(pkgPath)) {
        continue;
      }

      let manifest: Record<string, unknown>;
      try {
        const raw = await fs.promises.readFile(pkgPath, "utf8");
        manifest = JSON.parse(raw);
      } catch {
        continue;
      }

      const publisher = manifest.publisher as string | undefined;
      const name = manifest.name as string | undefined;
      if (!publisher || !name) {
        continue;
      }

      const id = `${publisher}.${name}`.toLowerCase();

      // Skip if already seen (first dir wins — Cursor before VS Code)
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);

      // Collect all files recursively (relative paths)
      const files = await collectFiles(extPath, "");

      results.push({ extensionPath: extPath, manifest, files });
    }
  }

  return results;
}

async function collectFiles(root: string, relative: string): Promise<string[]> {
  const result: string[] = [];
  const absDir = path.join(root, relative);

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(absDir, { withFileTypes: true });
  } catch {
    return result;
  }

  for (const entry of entries) {
    // Skip common noise
    if (entry.name === "node_modules" || entry.name === ".git") {
      continue;
    }

    const rel = relative ? `${relative}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      const sub = await collectFiles(root, rel);
      result.push(...sub);
    } else {
      result.push(rel);
    }
  }

  return result;
}
