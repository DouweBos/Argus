/**
 * DevTools for a session's browser. Chromium already serves both the CDP
 * endpoint and the DevTools frontend on its loopback debugging port; this
 * only finds the page's entry and makes its URLs absolute.
 */

import http from "node:http";
import { capture } from "../telemetry/telemetry";
import { webBrowserPool } from "./pool";

export interface BrowserDevtools {
  port: number;
  targetId: string;
  webSocketDebuggerUrl: string;
  devtoolsFrontendUrl: string;
}

interface CdpTarget {
  id: string;
  webSocketDebuggerUrl?: string;
  devtoolsFrontendUrl?: string;
}

/** Chromium reports the frontend relative to its own port, or not at all. */
export function devtoolsFor(
  port: number,
  targetId: string,
  targets: CdpTarget[],
): BrowserDevtools | null {
  const target = targets.find((t) => t.id === targetId);
  if (!target) {
    return null;
  }
  const origin = `127.0.0.1:${String(port)}`;
  const ws = `${origin}/devtools/page/${targetId}`;
  const frontend = target.devtoolsFrontendUrl?.startsWith("/")
    ? `http://${origin}${target.devtoolsFrontendUrl}`
    : `http://${origin}/devtools/inspector.html?ws=${ws}`;

  return {
    port,
    targetId,
    // Pinned to 127.0.0.1 whatever host name Chromium put in.
    webSocketDebuggerUrl: `ws://${ws}`,
    devtoolsFrontendUrl: frontend,
  };
}

function listTargets(port: number): Promise<CdpTarget[]> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${String(port)}/json`, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()) as CdpTarget[]);
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("CDP /json timed out")));
  });
}

export async function browserDevtools(
  sessionId: string,
): Promise<BrowserDevtools | null> {
  const reservation = webBrowserPool.getReservation(sessionId);
  const devtools = reservation
    ? devtoolsFor(
        reservation.cdpPort,
        reservation.cdpTargetId,
        await listTargets(reservation.cdpPort),
      )
    : null;
  capture("browser_devtools_requested", { available: devtools !== null });

  return devtools;
}
