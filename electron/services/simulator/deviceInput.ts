/**
 * Discovery for conductor's streaming device-input socket.
 *
 * `conductor input-server --device <key> --json` ensures the daemon + per-device
 * input WebSocket are up and returns its loopback URL. Argus's renderer then
 * connects to that URL directly and streams pointer/key/button frames (see
 * `app/lib/deviceInputClient.ts`), instead of injecting via the native
 * simulator/emulator bridges.
 *
 * Returns null on any failure — the caller falls back to the native input path,
 * which keeps input working while conductor's device-control migration lands
 * (the `input-server` command only exists on that conductor branch).
 */

import { spawn } from "node:child_process";
import { createLogger } from "../../../app/lib/logger";
import { getConductorBinPath } from "../cli/conductor";

const log = createLogger("simulator:deviceInput");

export interface DeviceInputEndpoint {
  device: string;
  inputPort: number;
  platform: string;
  /** ws://127.0.0.1:<inputPort>/input */
  url: string;
}

function runConductor(
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(getConductorBinPath(), args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => err.push(c));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({
        code,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      }),
    );
  });
}

/**
 * Resolve the streaming-input WebSocket for a device, starting the daemon/socket
 * if needed. Returns null when conductor can't provide one (older build, or the
 * device isn't reachable) so the caller can use the native fallback.
 */
export async function getDeviceInputEndpoint(
  deviceKey: string,
): Promise<DeviceInputEndpoint | null> {
  if (!deviceKey) {
    return null;
  }
  try {
    const res = await runConductor([
      "input-server",
      "--device",
      deviceKey,
      "--json",
    ]);
    if (res.code !== 0) {
      log.warn(
        `input-server unavailable for ${deviceKey} (exit ${res.code}); using native input`,
      );

      return null;
    }
    const line = res.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("{"))
      .pop();
    const info = line
      ? (JSON.parse(line) as Partial<DeviceInputEndpoint>)
      : null;
    if (!info || typeof info.url !== "string") {
      return null;
    }

    return {
      url: info.url,
      inputPort: typeof info.inputPort === "number" ? info.inputPort : 0,
      device: info.device ?? deviceKey,
      platform: info.platform ?? "",
    };
  } catch (err) {
    log.warn("input-server discovery failed; using native input", err);

    return null;
  }
}
