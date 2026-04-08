/**
 * Installs @houwert/conductor into `native/conductor/` as a self-contained
 * directory that electron-builder can bundle as an extraResource.
 *
 * Uses `npm install` (not pnpm) to create a flat node_modules layout with all
 * transitive dependencies resolved — no pnpm virtual store gymnastics needed.
 *
 * Run via: tsx scripts/prepare-conductor.ts
 * Also runs as part of `postinstall` alongside fetch-scrcpy-server.ts.
 *
 * The `native/conductor/` directory is gitignored (like `native/scrcpy-server/`).
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Configuration — bump this when upgrading conductor
// ---------------------------------------------------------------------------

const CONDUCTOR_VERSION = "0.2.0";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "native", "conductor");
const VERSION_FILE = path.join(OUT, ".version");

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  // Check if already prepared with the same version.
  if (existsSync(VERSION_FILE)) {
    const existing = readFileSync(VERSION_FILE, "utf-8").trim();
    if (existing === CONDUCTOR_VERSION) {
      console.log(
        `[prepare-conductor] native/conductor/ already at v${CONDUCTOR_VERSION}, skipping`,
      );
      return;
    }
  }

  console.log(
    `[prepare-conductor] Installing conductor v${CONDUCTOR_VERSION} into native/conductor/...`,
  );

  mkdirSync(OUT, { recursive: true });

  // Use npm to create a self-contained install with flat node_modules.
  // --ignore-scripts: skip conductor's postinstall (which registers as Claude plugin).
  // --no-package-lock: don't write a lockfile into native/conductor/.
  // --prefix: install into our target directory.
  execFileSync(
    "npm",
    [
      "install",
      `@houwert/conductor@${CONDUCTOR_VERSION}`,
      "--prefix",
      OUT,
      "--ignore-scripts",
      "--no-package-lock",
    ],
    {
      stdio: "inherit",
      cwd: ROOT,
      timeout: 60_000,
    },
  );

  // Write version marker for idempotency.
  writeFileSync(VERSION_FILE, CONDUCTOR_VERSION);

  console.log(
    `[prepare-conductor] Done — native/conductor/ ready (v${CONDUCTOR_VERSION})`,
  );
}

main();
