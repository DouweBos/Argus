/**
 * Path helpers for the bundled conductor CLI.
 *
 * Argus ships a self-contained conductor tree:
 *
 * - **Packaged app:** `<resourcesPath>/conductor/`
 * - **Development:** `<project>/native/conductor/`
 *
 * Inside that tree, `bin/conductor` is a small Node shim written once by
 * `scripts/prepare-conductor.ts`. The shim resolves its entry point via
 * `__dirname`-relative lookup, so it works in both layouts without having to
 * be rewritten at runtime.
 *
 * The shim exists because agents invoke `conductor --device ios` or
 * `--device web` — placeholders that only Argus understands. The shim
 * intercepts argv, POSTs to the MCP resolver to lazily acquire a simulator
 * or headless Chromium, and rewrites argv with the real device ID before
 * exec'ing the real conductor. Lazy acquisition means agents that never
 * touch a runtime never spin one up, and it runs before Claude's Bash
 * permission check so it works under `bypassPermissions` too.
 *
 * Agents pick the shim up via PATH — see `claude.ts` where we prepend the
 * conductor bin dir to the spawned agent's environment.
 */

import fs from "node:fs";
import path from "node:path";
import { resolveAssetPath } from "../tools/assets";

export function getConductorDir(): string {
  return resolveAssetPath("conductor");
}

export function getConductorBinDir(): string {
  return path.join(getConductorDir(), "bin");
}

export function getConductorBinPath(): string {
  return path.join(getConductorBinDir(), "conductor");
}

/**
 * Absolute path to the conductor SKILL.md, or `null` when the bundled
 * conductor package is unavailable (e.g. `prepare-conductor.ts` hasn't run).
 */
export function getConductorSkillPath(): string | null {
  const skillPath = path.join(
    getConductorDir(),
    "node_modules",
    "@houwert",
    "conductor",
    "skills",
    "conductor",
    "SKILL.md",
  );

  return fs.existsSync(skillPath) ? skillPath : null;
}
