/**
 * Headless server mode.
 *
 * `Argus Server.app` is a second electron-builder target built from this same
 * codebase. It boots the entire service layer with no BrowserWindow, keeping
 * only a tray item, so a Mac mini can run agents and simulators 24/7 while
 * laptops attach and detach over the remote gateway.
 *
 * Mode is decided by `ARGUS_SERVER=1`, which the packaged server bundle sets in
 * an esbuild banner (see `build-electron.mjs`) so it is in place before any
 * module reads `ARGUS_HOME` or `ARGUS_REMOTE_PORT` at import time. `pnpm
 * dev:server` sets the same variable from the shell.
 *
 * Leaf-level on purpose — only node builtins — so `lib/argusHome.ts` can
 * depend on it without pulling Electron into unit tests.
 */

import { spawn, type ChildProcess } from "node:child_process";

/** Whether this process is the headless server rather than the desktop app. */
export function isServerMode(): boolean {
  return process.env.ARGUS_SERVER === "1";
}

let caffeinate: ChildProcess | null = null;

/**
 * Hold a power assertion for as long as the server runs. A sleeping mini stops
 * agents mid-run and drops every attached client; `-w` ties the child's
 * lifetime to ours so a crash can't leave the machine pinned awake.
 */
export function startPowerAssertion(): void {
  if (process.platform !== "darwin" || caffeinate) {
    return;
  }
  try {
    caffeinate = spawn(
      "caffeinate",
      ["-i", "-m", "-s", "-w", String(process.pid)],
      {
        detached: true,
        stdio: "ignore",
      },
    );
    caffeinate.unref();
    caffeinate.on("exit", () => {
      caffeinate = null;
    });
  } catch {
    caffeinate = null;
  }
}

export function stopPowerAssertion(): void {
  if (!caffeinate) {
    return;
  }
  try {
    caffeinate.kill();
  } catch {
    // Best-effort; `caffeinate -w` exits on its own when we do.
  }
  caffeinate = null;
}
