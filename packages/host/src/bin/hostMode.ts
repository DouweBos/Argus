/**
 * Who launched `argus-host`, and what that means for it. Pure — `hostEnv.ts`
 * applies it at import time.
 *
 * - `desktop` (`--desktop`): the Mac app's host, on the desktop's own home.
 * - `server` (`--server`): Argus Server's menu-bar app supervising it 24/7.
 * - `cli` (neither): a terminal, standalone on `~/.argus-host`.
 */

import type { HostLockOwner } from "../lib/hostLock";
import path from "node:path";

export type HostMode = "cli" | "desktop" | "server";

export interface HostModeBehaviour {
  lockOwner: HostLockOwner;
  /** Bring the gateway up regardless of the remote-access setting. */
  forceRemote: boolean;
  /** Keep the Mac awake while the host runs. */
  powerAssertion: boolean;
  /** An app supervises the UI socket and restarts the host. */
  supervised: boolean;
  /** Let agents stop cleanly (and save) before the teardown. */
  drainAgentsOnQuit: boolean;
  /** Offer the interactive pair/login console on a TTY. */
  console: boolean;
  /** Print the gateway address at startup. */
  gatewayBanner: boolean;
}

export function parseHostMode(argv: readonly string[]): HostMode {
  if (argv.includes("--desktop")) {
    return "desktop";
  }

  return argv.includes("--server") ? "server" : "cli";
}

/** The env defaults `mode` sets; explicit values in `env` win. */
export function hostModeEnv(
  mode: HostMode,
  env: NodeJS.ProcessEnv,
  homedir: string,
): Record<string, string> {
  if (mode === "desktop") {
    return {};
  }

  return {
    ARGUS_SERVER: "1",
    // The server's supervisor always passes one; this matches argusHome's fallback.
    ARGUS_HOME:
      env.ARGUS_HOME ||
      path.join(homedir, mode === "server" ? ".argus-server" : ".argus-host"),
    ARGUS_REMOTE_PORT: env.ARGUS_REMOTE_PORT || "47617",
  };
}

const BEHAVIOURS: Record<HostMode, HostModeBehaviour> = {
  desktop: {
    lockOwner: "mac",
    forceRemote: false,
    powerAssertion: false,
    supervised: true,
    drainAgentsOnQuit: true,
    console: false,
    gatewayBanner: false,
  },
  server: {
    lockOwner: "mac-server",
    forceRemote: true,
    powerAssertion: true,
    supervised: true,
    drainAgentsOnQuit: true,
    console: false,
    gatewayBanner: true,
  },
  cli: {
    lockOwner: "cli",
    forceRemote: true,
    powerAssertion: true,
    supervised: false,
    drainAgentsOnQuit: false,
    console: true,
    gatewayBanner: true,
  },
};

export function hostModeBehaviour(mode: HostMode): HostModeBehaviour {
  return BEHAVIOURS[mode];
}

/**
 * Loopback pairing skips the SAS check, so like Electron's `!app.isPackaged`
 * gate it never runs from an installed release: a Debug build's resources sit
 * in DerivedData or a checkout, a shipped app's under an `Applications` folder.
 */
export function devTrustAllowed(
  env: NodeJS.ProcessEnv,
  homedir: string,
): boolean {
  if (env.ARGUS_DEV_TRUST !== "1") {
    return false;
  }
  const resources = env.ARGUS_RESOURCES;
  if (!resources) {
    return true;
  }
  const resolved = path.resolve(resources);

  return ![
    path.join("/", "Applications"),
    path.join(homedir, "Applications"),
  ].some((dir) => resolved.startsWith(`${dir}${path.sep}`));
}
