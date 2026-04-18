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
 *
 * ## Local development against an unpublished conductor
 *
 * Set `CONDUCTOR_LOCAL` to a path (absolute, or relative to this repo root)
 * pointing at a local conductor CLI package directory — typically
 * `../conductor/packages/cli` when the two repos are siblings. The local
 * package will be installed via `npm install <dir>` so all transitive deps
 * resolve normally. Local-mode installs bypass the version cache so rebuilds
 * are always picked up.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { log } from "../app/lib/logger";

// ---------------------------------------------------------------------------
// Configuration — bump this when upgrading conductor
// ---------------------------------------------------------------------------

const CONDUCTOR_VERSION = "0.8.0";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "native", "conductor");
const VERSION_FILE = path.join(OUT, ".version");

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function resolveLocalPath(raw: string): string {
  const expanded = raw.startsWith("~")
    ? path.join(process.env.HOME ?? "", raw.slice(1))
    : raw;
  const resolved = path.isAbsolute(expanded)
    ? expanded
    : path.resolve(ROOT, expanded);
  if (!existsSync(path.join(resolved, "package.json"))) {
    throw new Error(`CONDUCTOR_LOCAL path has no package.json: ${resolved}`);
  }

  return resolved;
}

function installFromRegistry(): void {
  if (existsSync(VERSION_FILE)) {
    const existing = readFileSync(VERSION_FILE, "utf-8").trim();
    if (existing === CONDUCTOR_VERSION) {
      log(
        `[prepare-conductor] native/conductor/ already at v${CONDUCTOR_VERSION}, skipping`,
      );

      return;
    }
  }

  log(
    `[prepare-conductor] Installing conductor v${CONDUCTOR_VERSION} from registry into native/conductor/...`,
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

  writeFileSync(VERSION_FILE, CONDUCTOR_VERSION);

  log(
    `[prepare-conductor] Done — native/conductor/ ready (v${CONDUCTOR_VERSION})`,
  );
}

function installFromLocal(sourceDir: string): void {
  log(`[prepare-conductor] Installing conductor from local path: ${sourceDir}`);

  mkdirSync(OUT, { recursive: true });

  // `npm install <dir>` copies the package into OUT/node_modules/@houwert/conductor
  // and resolves its dependencies flatly, just like the registry path — but it
  // skips the tarball fetch. `file:` specifiers in npm install from a directory
  // run the package's own `prepare` script (good: ensures `dist/` is built).
  execFileSync(
    "npm",
    [
      "install",
      sourceDir,
      "--prefix",
      OUT,
      "--ignore-scripts",
      "--no-package-lock",
      "--install-links=true", // copy instead of symlink so electron-builder bundles real files
    ],
    {
      stdio: "inherit",
      cwd: ROOT,
      timeout: 120_000,
    },
  );

  // Drop the version marker — local builds aren't version-locked, so the next
  // run should always reinstall to pick up source changes.
  rmSync(VERSION_FILE, { force: true });

  log(
    `[prepare-conductor] Done — native/conductor/ ready (local: ${sourceDir})`,
  );
}

function main(): void {
  const local = process.env.CONDUCTOR_LOCAL?.trim();
  if (local) {
    installFromLocal(resolveLocalPath(local));

    return;
  }

  installFromRegistry();
}

main();
