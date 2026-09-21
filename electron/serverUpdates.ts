/**
 * Tray-driven updates for the headless server.
 *
 * `updater_check`, `updater_download` and `updater_quit_and_install` are
 * host-tier on purpose: an attached client must never restart a host out from
 * under someone else's running agents. The desktop satisfies that with a window;
 * a packaged server has only its menu bar, which previously left a mini with no
 * way to update short of SSH'ing in and replacing the `.app` by hand.
 *
 * So the flow lives in the tray, mirroring `serverPairing`: this module owns the
 * state, the tray renders it. The restart is the part that needs a guard —
 * installing kills every agent on the machine, so it refuses while any agent is
 * working and says so instead of failing quietly.
 */

import type { UpdaterState } from "./services/updater";
import { addHostEventSink } from "@argus/host/bus";
import { isServerMode } from "@argus/host/serverMode";
import {
  loadAppSettings,
  saveAppSettings,
} from "@argus/host/services/appSettings/store";
import { countActiveAgents } from "./services/agentActivity";
import {
  checkForUpdates,
  downloadUpdate,
  getUpdaterState,
  quitAndInstallUpdate,
} from "./services/updater";

export type ServerUpdateState =
  | { kind: "available"; version: string }
  | { kind: "checking" }
  | { kind: "downloading"; percent: number }
  | { kind: "error"; message: string }
  | { kind: "idle" }
  | { kind: "ready"; version: string }
  | { kind: "up_to_date" };

export type InstallOutcome =
  | { ok: false; reason: "agents_running"; activeAgents: number }
  | { ok: false; reason: "not_ready" }
  | { ok: true };

let onChange: (() => void) | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let removeSink: (() => void) | null = null;

/** The tray rebuilds its menu from scratch on each change; nothing to diff. */
export function setServerUpdateListener(listener: (() => void) | null): void {
  onChange = listener;
}

/**
 * Collapse the updater's phase into the handful of things a menu can say. The
 * current version is already the first line of the server's menu, so only the
 * *new* version is named here.
 */
export function describeServerUpdate(u: UpdaterState): ServerUpdateState {
  switch (u.phase) {
    case "available":
      return { kind: "available", version: u.updateVersion ?? "unknown" };
    case "checking":
      return { kind: "checking" };
    case "downloaded":
      return { kind: "ready", version: u.updateVersion ?? "unknown" };
    case "downloading":
      return { kind: "downloading", percent: u.progressPercent };
    case "error":
      return { kind: "error", message: u.error ?? "unknown error" };
    case "not-available":
      return { kind: "up_to_date" };
    case "idle":
      return { kind: "idle" };
  }
}

export function getServerUpdateState(): ServerUpdateState {
  return describeServerUpdate(getUpdaterState());
}

export async function checkServerUpdates(): Promise<void> {
  await checkForUpdates({ silent: false });
}

export async function downloadServerUpdate(): Promise<void> {
  await downloadUpdate();
}

/**
 * Whether restarting right now is safe. Agents die with the process, and a
 * server exists precisely so agents can keep running while nobody is watching.
 */
export function canInstallServerUpdate(): InstallOutcome {
  if (getUpdaterState().phase !== "downloaded") {
    return { ok: false, reason: "not_ready" };
  }
  const activeAgents = countActiveAgents();
  if (activeAgents > 0) {
    return { ok: false, reason: "agents_running", activeAgents };
  }

  return { ok: true };
}

/** Restart into the downloaded update, unless an agent is mid-run. */
export function installServerUpdate(): InstallOutcome {
  const verdict = canInstallServerUpdate();
  if (verdict.ok) {
    quitAndInstallUpdate();
  }

  return verdict;
}

/** Off by default: a restart nobody asked for is a surprising thing for a mini. */
export function isServerAutoInstallEnabled(): boolean {
  return loadAppSettings().server_auto_install_updates === true;
}

export function setServerAutoInstallEnabled(enabled: boolean): void {
  saveAppSettings({
    ...loadAppSettings(),
    server_auto_install_updates: enabled,
  });
  onChange?.();
  maybeAutoInstall();
}

function maybeAutoInstall(): void {
  if (!isServerAutoInstallEnabled()) {
    return;
  }
  installServerUpdate();
}

/**
 * Watch the updater and, when asked to, take the update the moment the machine
 * goes quiet. The feed check itself is the updater's own hourly background poll
 * — an hour is already tighter than anyone needs on a machine that runs for
 * weeks, and a second timer would only double the traffic.
 *
 * The idle sweep is separate because "the last agent finished" is not an updater
 * event; a minute of latency on an unattended restart costs nothing.
 */
export function initServerUpdates(): void {
  if (!isServerMode() || removeSink) {
    return;
  }
  removeSink = addHostEventSink((channel) => {
    if (channel !== "updater:state") {
      return;
    }
    onChange?.();
    maybeAutoInstall();
  });
  idleTimer = setInterval(() => maybeAutoInstall(), 60_000);
}

export function stopServerUpdates(): void {
  removeSink?.();
  removeSink = null;
  if (idleTimer) {
    clearInterval(idleTimer);
    idleTimer = null;
  }
  onChange = null;
}
