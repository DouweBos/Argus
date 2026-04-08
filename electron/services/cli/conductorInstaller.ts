/**
 * Makes the bundled `conductor` CLI available to agents at
 * `~/.stagehand/bin/conductor`.
 *
 * In development, the conductor package lives at `native/conductor/` (prepared
 * by `scripts/prepare-conductor.ts`). In production, electron-builder copies it
 * to `process.resourcesPath/conductor/` via extraResources.
 *
 * A small wrapper shell script is written to `~/.stagehand/bin/conductor` that
 * invokes `node <conductorDir>/node_modules/@houwert/conductor/dist/index.js`.
 * Since `~/.stagehand/bin/` is already on every agent's PATH, this makes
 * `conductor` available to all agents without any global install.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";

const BIN_DIR = path.join(os.homedir(), ".stagehand", "bin");
const BIN_PATH = path.join(BIN_DIR, "conductor");

/**
 * Resolve the directory containing the conductor package.
 *
 * - Packaged app: `process.resourcesPath/conductor/`
 * - Development: `<cwd>/native/conductor/`
 */
function getConductorDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "conductor")
    : path.join(process.cwd(), "native", "conductor");
}

/**
 * Write a wrapper script to `~/.stagehand/bin/conductor` that invokes the
 * bundled conductor CLI via Node.js.
 *
 * Overwrites any existing script to ensure it always points to the current
 * app installation.
 */
export function installConductor(): void {
  const conductorDir = getConductorDir();
  const entryPoint = path.join(
    conductorDir,
    "node_modules",
    "@houwert",
    "conductor",
    "dist",
    "index.js",
  );

  if (!fs.existsSync(entryPoint)) {
    console.warn(
      `[conductor-installer] Entry point not found at ${entryPoint}, skipping`,
    );
    return;
  }

  const script = ["#!/bin/sh", `exec node "${entryPoint}" "$@"`, ""].join("\n");

  try {
    fs.mkdirSync(BIN_DIR, { recursive: true });
    fs.writeFileSync(BIN_PATH, script);
    fs.chmodSync(BIN_PATH, 0o755);
    console.info(
      `[conductor-installer] Installed conductor CLI to ${BIN_PATH}`,
    );
  } catch (e) {
    console.warn(
      `[conductor-installer] Failed to install conductor: ${String(e)}`,
    );
  }
}

/**
 * Return the absolute path to the conductor SKILL.md file, or `null` if the
 * bundled conductor package is not available.
 */
export function getConductorSkillPath(): string | null {
  const conductorDir = getConductorDir();
  const skillPath = path.join(
    conductorDir,
    "node_modules",
    "@houwert",
    "conductor",
    "skills",
    "conductor",
    "SKILL.md",
  );
  return fs.existsSync(skillPath) ? skillPath : null;
}
