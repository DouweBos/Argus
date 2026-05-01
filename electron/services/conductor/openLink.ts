/**
 * Open a URL / deep link on a connected device via the conductor CLI.
 *
 * Drives `conductor open-link <url> --device <id>`, where `<id>` is the
 * iOS UDID, Android serial, or web browser deviceId — the same value that
 * already keys the runtime view.
 */

import { execConductor } from "./logger";

export async function openDeepLink(
  deviceKey: string,
  url: string,
): Promise<void> {
  if (!deviceKey) {
    throw "No device selected";
  }
  if (!url) {
    throw "Deep link URL is required";
  }
  try {
    await execConductor(deviceKey, ["open-link", url, "--device", deviceKey]);
  } catch (e) {
    const err = e as { message?: string; stderr?: string };
    throw err.stderr || err.message || String(e);
  }
}
