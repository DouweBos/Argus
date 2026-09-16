/**
 * Development-only loopback pairing.
 *
 * SAS pairing assumes two devices and two screens: the host shows six digits
 * and a human confirms. A headless server has no screen, and a desktop pairing
 * with a server on the same Mac has nobody to compare against. So in dev we
 * arm a pairing session against `127.0.0.1`, auto-confirm the SAS, and drop the
 * pairing code on disk for the client to read.
 *
 * This bypasses the anti-MITM confirmation and must never run in a shipped
 * app: it is gated on `ARGUS_DEV_TRUST=1` *and* an unpackaged build, and the
 * packaged check is the one that actually matters.
 */

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { log } from "../app/lib/logger";
import { argusHomeDir } from "./lib/argusHome";
import {
  cancelPairing,
  confirmPairing,
  startPairing,
} from "./services/remote/pairing";
import { LOCAL_GATEWAY_PORT } from "./services/remote/remoteService";

/** Where the current loopback pairing code is published for a dev client. */
export function devPairingFile(): string {
  return path.join(argusHomeDir(), "dev-pairing.json");
}

let armed = false;

function publish(payload: { qrPayload: string; pairingCode: string }): void {
  fs.mkdirSync(argusHomeDir(), { recursive: true });
  fs.writeFileSync(
    devPairingFile(),
    `${JSON.stringify(
      {
        created_at: Date.now(),
        pairing_code: payload.pairingCode,
        payload: JSON.parse(payload.qrPayload) as unknown,
      },
      null,
      2,
    )}\n`,
  );
}

async function arm(): Promise<void> {
  const url = `ws://127.0.0.1:${LOCAL_GATEWAY_PORT}`;
  const started = await startPairing(url, {
    onSas: () => {
      // No second screen to compare against — that is the whole point.
      confirmPairing(true).catch((e) =>
        log("[dev-trust] auto-confirm failed: %s", String(e)),
      );
    },
    onPaired: (device) => {
      log("[dev-trust] paired device %s — re-arming", device.device_id);
      rearm();
    },
    onError: (message) => {
      log("[dev-trust] pairing ended (%s) — re-arming", message);
      rearm();
    },
  });
  publish(started);
  log(
    "[dev-trust] loopback pairing armed at %s — code in %s",
    url,
    devPairingFile(),
  );
}

function rearm(): void {
  if (!armed) {
    return;
  }
  arm().catch((e) => log("[dev-trust] re-arm failed: %s", String(e)));
}

/**
 * Arm loopback pairing if this is a dev build with `ARGUS_DEV_TRUST=1`.
 * Requires the gateway to already be listening.
 */
export async function startDevTrust(): Promise<void> {
  if (app.isPackaged || process.env.ARGUS_DEV_TRUST !== "1") {
    return;
  }
  armed = true;
  await arm();
}

export function stopDevTrust(): void {
  if (!armed) {
    return;
  }
  armed = false;
  cancelPairing();
  fs.rmSync(devPairingFile(), { force: true });
}
