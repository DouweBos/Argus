/**
 * Installs the `stagehand` CLI script to `~/.stagehand/bin/stagehand`
 * so it's available to agents and terminal sessions.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";

const INSTALL_DIR = path.join(os.homedir(), ".stagehand", "bin");
const INSTALL_PATH = path.join(INSTALL_DIR, "stagehand");

/**
 * Copy the bundled `stagehand.sh` CLI script to `~/.stagehand/bin/stagehand`.
 *
 * In development, reads from `electron/cli/stagehand.sh` relative to CWD.
 * In production, reads from the app's `extraResources`.
 *
 * Overwrites any existing installation to ensure the latest version is used.
 */
export function installCli(): void {
  const sourcePath = app.isPackaged
    ? path.join(process.resourcesPath, "stagehand.sh")
    : path.join(process.cwd(), "electron", "cli", "stagehand.sh");

  if (!fs.existsSync(sourcePath)) {
    console.warn(
      `[cli-installer] CLI script not found at ${sourcePath}, skipping install`,
    );
    return;
  }

  try {
    fs.mkdirSync(INSTALL_DIR, { recursive: true });
    fs.copyFileSync(sourcePath, INSTALL_PATH);
    fs.chmodSync(INSTALL_PATH, 0o755);
    console.info(`[cli-installer] Installed stagehand CLI to ${INSTALL_PATH}`);
  } catch (e) {
    console.warn(`[cli-installer] Failed to install CLI: ${String(e)}`);
  }
}
