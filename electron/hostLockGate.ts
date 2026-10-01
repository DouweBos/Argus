/**
 * The desktop's side of the one-host-per-`ARGUS_HOME` lock: refuse to boot a
 * second host on the same state directory, and offer to quit whoever has it.
 */

import { app, dialog } from "electron";
import { argusHomeDir } from "@argus/host/lib/argusHome";
import {
  acquireHostLock,
  releaseHostLock,
  waitForHostLockRelease,
  type HostLockOwner,
  type HostLockRecord,
} from "@argus/host/lib/hostLock";
import { capture } from "@argus/host/services/telemetry/telemetry";

const HOLDER_NAMES: Record<HostLockOwner, string> = {
  cli: "An Argus host",
  electron: "Another copy of Argus",
  mac: "Argus for Mac",
};

/** Telemetry can't be sent before the host is up, so the handover waits here. */
let handedOverFrom: HostLockOwner | null = null;

function askToQuitHolder(holder: HostLockRecord): boolean {
  const name = HOLDER_NAMES[holder.owner];
  const choice = dialog.showMessageBoxSync({
    type: "warning",
    message: `${name} is already running`,
    detail: `It is using ${argusHomeDir()}. Two hosts on the same Argus home would fight over its sessions and agents, so only one can run at a time.`,
    buttons: ["Quit Argus", "Quit It and Continue"],
    defaultId: 0,
    cancelId: 0,
  });

  return choice === 1;
}

/**
 * Take the host lock, or settle the conflict with the user. Resolves false
 * when this app should quit instead of starting its host.
 */
export async function claimHostLock(): Promise<boolean> {
  const first = acquireHostLock("electron");
  if (first.ok) {
    installRelease();

    return true;
  }
  if (!askToQuitHolder(first.holder)) {
    return false;
  }
  try {
    // The owner, not the host pid: the Mac app would just restart its host.
    process.kill(first.holder.owner_pid, "SIGTERM");
  } catch {
    // Already gone.
  }
  const released = await waitForHostLockRelease(20_000);
  const second = released ? acquireHostLock("electron") : null;
  if (!second?.ok) {
    dialog.showErrorBox(
      "Argus couldn't start",
      `${HOLDER_NAMES[first.holder.owner]} didn't quit in time. Quit it and open Argus again.`,
    );

    return false;
  }
  handedOverFrom = first.holder.owner;
  installRelease();

  return true;
}

function installRelease(): void {
  app.on("will-quit", () => releaseHostLock());
  process.on("exit", () => releaseHostLock());
}

/** Report a handover once telemetry is running. */
export function reportHostLockHandover(): void {
  if (handedOverFrom) {
    capture("host_lock_handover", { holder: handedOverFrom });
    handedOverFrom = null;
  }
}
