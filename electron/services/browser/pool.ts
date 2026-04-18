/**
 * Web browser pool — manages a set of Conductor-backed Chromium instances so
 * each agent gets its own dedicated browser.
 *
 * Each browser is a Conductor daemon running in standalone mode (no CDP
 * attachment). Conductor launches Chromium with `--remote-debugging-port` and
 * exposes that port via its `/status` endpoint. Argus connects to the CDP
 * port for screencast only; all input goes through Conductor's HTTP API.
 *
 * Modelled on `SimulatorPool` for iOS.
 */

import { randomBytes } from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { info } from "../../../app/lib/logger";
import { appState, type WebBrowserReservation } from "../../state";
import { execConductor } from "../conductor/logger";

const CONDUCTOR_DIR = path.join(os.homedir(), ".conductor");

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 500;
const MAX_POLL_MS = 60_000;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function daemonSocketPath(deviceId: string): string {
  return path.join(CONDUCTOR_DIR, "daemons", deviceId, "daemon.sock");
}

function httpGetOverSocket(
  socketPath: string,
  urlPath: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get({ socketPath, path: urlPath }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf-8"),
        });
      });
    });
    req.on("error", reject);
    req.setTimeout(5000, () =>
      req.destroy(new Error("Socket request timed out")),
    );
  });
}

interface DaemonStatus {
  ok: boolean;
  platform: string;
  driverPort: number;
  chromiumCdpPort: number | null;
  pageTargetId: string | null;
  driverStartError: string | null;
}

/**
 * Poll the daemon's Unix socket /status until chromiumCdpPort and pageTargetId
 * are populated (the browser has finished launching).
 */
async function pollDaemonStatus(deviceId: string): Promise<DaemonStatus> {
  const sock = daemonSocketPath(deviceId);
  const deadline = Date.now() + MAX_POLL_MS;
  let lastResponse = "";

  while (Date.now() < deadline) {
    let data: DaemonStatus | null = null;
    try {
      const { status, body } = await httpGetOverSocket(sock, "/status");
      lastResponse = `HTTP ${status}: ${body.slice(0, 200)}`;
      if (status === 200) {
        data = JSON.parse(body) as DaemonStatus;
      }
    } catch (e) {
      lastResponse = `error: ${e instanceof Error ? e.message : String(e)}`;
    }

    if (data?.driverStartError) {
      throw new Error(
        `Conductor driver failed to start on ${deviceId}: ${data.driverStartError}`,
      );
    }
    if (
      data?.chromiumCdpPort &&
      data.chromiumCdpPort > 0 &&
      data.pageTargetId
    ) {
      return data;
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(
    `Timed out waiting for conductor daemon /status on ${deviceId} ` +
      `(last response: ${lastResponse})`,
  );
}

// ---------------------------------------------------------------------------
// WebBrowserPool
// ---------------------------------------------------------------------------

class WebBrowserPool {
  /**
   * Serialization queue: each acquisition/release chains onto this promise so
   * concurrent calls don't race on daemon startup or reservation checks.
   */
  private pendingOp: Promise<void> = Promise.resolve();

  /**
   * Acquire a dedicated browser for an agent. Starts a Conductor daemon with
   * a unique device ID, waits for the browser to become ready, and records
   * the reservation.
   */
  async acquireBrowser(agentId: string): Promise<WebBrowserReservation> {
    return new Promise<WebBrowserReservation>((resolve, reject) => {
      this.pendingOp = this.pendingOp
        .then(async () => {
          const reservation = await this.doAcquire(agentId);
          resolve(reservation);
        })
        .catch((e) => reject(e));
    });
  }

  /**
   * Release a browser reservation and stop the daemon.
   *
   * Idempotent — safe to call from both `stopAgent` and the process `close`
   * handler without worrying about double-release.
   */
  async releaseBrowser(agentId: string): Promise<void> {
    return new Promise<void>((resolve) => {
      this.pendingOp = this.pendingOp
        .then(async () => {
          await this.doRelease(agentId);
          resolve();
        })
        .catch(() => {
          resolve();
        });
    });
  }

  /** Get the reservation for an agent, or null. */
  getReservation(agentId: string): WebBrowserReservation | null {
    return appState.webBrowserReservations.get(agentId) ?? null;
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private async doAcquire(agentId: string): Promise<WebBrowserReservation> {
    const hex = randomBytes(4).toString("hex");
    const deviceId = `web:chromium:${hex}`;

    info(`[web-browser-pool] Starting conductor daemon for ${deviceId}`);

    await execConductor(deviceId, ["daemon-start", "--device", deviceId], {
      env: {
        ...process.env,
        CONDUCTOR_IDLE_TIMEOUT_MS: String(TWENTY_FOUR_HOURS_MS),
        CONDUCTOR_HEADLESS: "1",
      },
    });

    info(`[web-browser-pool] Polling daemon /status for ${deviceId}`);
    const status = await pollDaemonStatus(deviceId);

    const reservation: WebBrowserReservation = {
      agentId,
      deviceId,
      cdpPort: status.chromiumCdpPort!,
      cdpTargetId: status.pageTargetId!,
      driverPort: status.driverPort,
    };

    appState.webBrowserReservations.set(agentId, reservation);
    info(
      `[web-browser-pool] Reserved ${deviceId} → agent ${agentId} ` +
        `(cdpPort=${reservation.cdpPort}, driverPort=${reservation.driverPort})`,
    );

    return reservation;
  }

  private async doRelease(agentId: string): Promise<void> {
    const reservation = appState.webBrowserReservations.get(agentId);
    if (!reservation) {
      return;
    }

    info(
      `[web-browser-pool] Releasing ${reservation.deviceId} from agent ${agentId}`,
    );

    try {
      await execConductor(reservation.deviceId, [
        "session",
        "--clear",
        "--device",
        reservation.deviceId,
      ]);
    } catch {
      // Session might not exist
    }

    try {
      await execConductor(reservation.deviceId, [
        "daemon-stop",
        "--device",
        reservation.deviceId,
      ]);
    } catch {
      // Daemon might already be stopped
    }

    appState.webBrowserReservations.delete(agentId);
  }
}

/** Singleton pool instance. */
export const webBrowserPool = new WebBrowserPool();
