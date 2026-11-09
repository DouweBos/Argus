/**
 * Where Conductor (conductor.build) keeps its workspaces, so the git
 * worktrees it made show up as Argus sessions. Conductor defaults to
 * `~/conductor/…`; a custom location sits in `~/.conductor/settings.toml`
 * under a key its docs don't name, so any workspace-ish path there counts.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { canonicalPath } from "../../lib/canonicalPath";
import { isInsideRoot } from "./worktreeLocationCore";

const WORKSPACE_KEY = /workspace.*(dir|path|location|root)/i;

let cache: { file: string; mtimeMs: number; roots: string[] } | null = null;

function expandHome(p: string, home: string): string {
  return p === "~" || p.startsWith("~/") ? path.join(home, p.slice(1)) : p;
}

/** String values under workspace-location keys, at any depth. */
export function workspacePathsInSettings(settings: unknown): string[] {
  const found: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node !== "object" || node === null || Array.isArray(node)) {
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === "string" && WORKSPACE_KEY.test(k) && v.trim()) {
        found.push(v.trim());
      } else {
        walk(v);
      }
    }
  };
  walk(settings);

  return found;
}

function configuredRoots(home: string): string[] {
  const file = path.join(home, ".conductor", "settings.toml");
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    return [];
  }
  if (cache?.file === file && cache.mtimeMs === mtimeMs) {
    return cache.roots;
  }
  let roots: string[] = [];
  try {
    roots = workspacePathsInSettings(parseToml(fs.readFileSync(file, "utf8")))
      .map((p) => expandHome(p, home))
      .filter((p) => path.isAbsolute(p));
  } catch {
    // A settings file Conductor itself would reject.
  }
  cache = { file, mtimeMs, roots };

  return roots;
}

/** Every directory Conductor may have put a workspace in. */
export function conductorWorkspaceRoots(home = os.homedir()): string[] {
  return [...new Set([path.join(home, "conductor"), ...configuredRoots(home)])];
}

export function isConductorWorkspacePath(
  target: string,
  home = os.homedir(),
): boolean {
  const real = canonicalPath(target);

  return conductorWorkspaceRoots(home).some((root) =>
    isInsideRoot(canonicalPath(root), real),
  );
}
