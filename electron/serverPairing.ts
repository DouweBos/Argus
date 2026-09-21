/**
 * Tray-driven pairing for the headless server.
 *
 * Pairing is the root of trust, so `remote_start_pairing` is host-tier and
 * never crosses the wire — it needs a human at the host's console. The desktop
 * has a window for that; the server has a menu bar and nothing else, which
 * previously left a packaged server with no way to accept its first device.
 *
 * The whole flow therefore lives in the tray: arm, read the SAS off the menu,
 * confirm or reject. The anti-MITM comparison is preserved — this is a second
 * surface for it, not a bypass like `ARGUS_DEV_TRUST`.
 */

import { clipboard } from "electron";
import fs from "node:fs";
import path from "node:path";
import { argusHomeDir } from "@argus/host/lib/argusHome";
import { isGatewayOnLan } from "@argus/host/services/remote/localGatewayServer";
import {
  cancelPairing,
  confirmPairing,
  startPairing,
} from "@argus/host/services/remote/pairing";
import {
  getLanUrl,
  getPublicUrl,
} from "@argus/host/services/remote/remoteService";

export type ServerPairingState =
  | { kind: "armed" }
  | { kind: "awaiting_sas"; sas: string }
  | { kind: "error"; message: string }
  | { kind: "idle" }
  | { kind: "paired"; label: string };

let state: ServerPairingState = { kind: "idle" };
let onChange: (() => void) | null = null;

/** The tray rebuilds its menu from scratch on each change; nothing to diff. */
export function setServerPairingListener(listener: (() => void) | null): void {
  onChange = listener;
}

export function getServerPairingState(): ServerPairingState {
  return state;
}

function transition(next: ServerPairingState): void {
  state = next;
  onChange?.();
}

/**
 * Where the pairing code lands for a mini you only reach over SSH. The clipboard
 * is useless there, and the code is too long to read off a menu item.
 *
 * It holds a short-lived secret that is still gated by the SAS comparison, so
 * it is written 0600 and removed the moment pairing settles either way.
 */
function codeFilePath(): string {
  return path.join(argusHomeDir(), "pairing-code.txt");
}

function writeCodeFile(code: string): void {
  try {
    fs.writeFileSync(codeFilePath(), `${code}\n`, { mode: 0o600 });
  } catch {
    // Best-effort: the clipboard copy is the primary path.
  }
}

function clearCodeFile(): void {
  try {
    fs.rmSync(codeFilePath(), { force: true });
  } catch {
    // Already gone.
  }
}

/**
 * Arm a pairing session and publish the code. Falls back to the LAN URL when no
 * tunnel is up — a server on your desk is the common case, and `getPublicUrl()`
 * only reports the LAN when `remote_lan_web` happens to be on.
 */
export async function startServerPairing(): Promise<void> {
  // Only offer the LAN address if the gateway is actually listening on it —
  // otherwise the code carries a URL that can never be dialled.
  const url = getPublicUrl() ?? (isGatewayOnLan() ? getLanUrl() : null);
  if (!url) {
    transition({
      kind: "error",
      message: "no reachable address — check the network",
    });

    return;
  }

  try {
    const { pairingCode } = await startPairing(url, {
      onSas: (sas) => transition({ kind: "awaiting_sas", sas }),
      onPaired: (device) => {
        clearCodeFile();
        transition({ kind: "paired", label: device.label });
      },
      onError: (message) => {
        clearCodeFile();
        transition({ kind: "error", message });
      },
    });
    clipboard.writeText(pairingCode);
    writeCodeFile(pairingCode);
    transition({ kind: "armed" });
  } catch (err) {
    transition({
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Grants are chosen explicitly at the menu, never defaulted to admin. */
export async function confirmServerPairing(grants: {
  admin: boolean;
  control: boolean;
}): Promise<void> {
  try {
    await confirmPairing(grants);
  } catch (err) {
    clearCodeFile();
    transition({
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export function cancelServerPairing(): void {
  cancelPairing();
  clearCodeFile();
  transition({ kind: "idle" });
}

/** Drop a settled result back to idle so the menu stops showing it. */
export function dismissServerPairing(): void {
  if (state.kind === "paired" || state.kind === "error") {
    transition({ kind: "idle" });
  }
}
