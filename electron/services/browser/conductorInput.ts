/**
 * HTTP client for forwarding UI input to Conductor's web-server endpoints.
 *
 * Each function maps a Stagehand IPC browser action to the corresponding
 * Conductor REST endpoint, using the driver port from the browser reservation.
 */

import http from "node:http";
import { warn } from "../../../app/lib/logger";
import type { WebBrowserReservation } from "../../state";

export interface BrowserPreset {
  internalWidth: number;
  internalHeight: number;
  userAgent?: string;
  screenPosition?: "desktop" | "mobile";
}

// ---------------------------------------------------------------------------
// Internal HTTP helper
// ---------------------------------------------------------------------------

function postJson(
  port: number,
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
          } catch {
            resolve({});
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(30_000, () =>
      req.destroy(new Error("Conductor request timed out")),
    );
    req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Public API — each maps a Stagehand IPC call to a Conductor endpoint
// ---------------------------------------------------------------------------

export async function tap(
  reservation: WebBrowserReservation,
  x: number,
  y: number,
): Promise<void> {
  await postJson(reservation.driverPort, "/tap", { x, y });
}

export async function mouseEvent(
  reservation: WebBrowserReservation,
  type: "click" | "down" | "move" | "up",
  x: number,
  y: number,
  _button?: "left" | "middle" | "right",
): Promise<void> {
  switch (type) {
    case "click":
      await postJson(reservation.driverPort, "/tap", { x, y });
      break;
    case "move":
      // Conductor has no mouse-move equivalent — skip
      break;
    case "down":
    case "up":
      // Simplify down/up to a tap at the position
      if (type === "up") {
        await postJson(reservation.driverPort, "/tap", { x, y });
      }
      break;
  }
}

export async function keyboardEvent(
  reservation: WebBrowserReservation,
  _type: "down" | "press" | "up",
  key: string,
): Promise<void> {
  // Simplify all key event types to a single press
  await postJson(reservation.driverPort, "/pressKey", { key });
}

export async function wheelEvent(
  reservation: WebBrowserReservation,
  x: number,
  y: number,
  deltaX: number,
  deltaY: number,
): Promise<void> {
  // The /swipe endpoint negates deltas internally (finger-path → wheel),
  // so we pre-negate here to preserve the original wheel direction.
  await postJson(reservation.driverPort, "/swipe", {
    startX: x,
    startY: y,
    endX: x - deltaX,
    endY: y - deltaY,
  });
}

export interface NavState {
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
}

function extractNavState(result: Record<string, unknown>): NavState {
  return {
    url: (result.url as string) ?? "",
    canGoBack: (result.canGoBack as boolean) ?? false,
    canGoForward: (result.canGoForward as boolean) ?? false,
  };
}

export async function navigate(
  reservation: WebBrowserReservation,
  url: string,
): Promise<NavState> {
  const result = await postJson(reservation.driverPort, "/navigate", { url });
  return extractNavState(result);
}

export async function goBack(
  reservation: WebBrowserReservation,
): Promise<NavState> {
  const result = await postJson(reservation.driverPort, "/goBack", {});
  return extractNavState(result);
}

export async function goForward(
  reservation: WebBrowserReservation,
): Promise<NavState> {
  const result = await postJson(reservation.driverPort, "/goForward", {});
  return extractNavState(result);
}

export async function reload(
  reservation: WebBrowserReservation,
): Promise<NavState> {
  const result = await postJson(reservation.driverPort, "/reload", {});
  return extractNavState(result);
}

/**
 * Update viewport via Conductor's /setViewport endpoint. Returns the new CDP
 * target ID (context recreation changes the target).
 */
export async function setViewport(
  reservation: WebBrowserReservation,
  params: {
    width: number;
    height: number;
    userAgent?: string;
    deviceScaleFactor?: number;
    isMobile?: boolean;
    colorScheme?: "dark" | "light";
  },
): Promise<string | null> {
  const result = await postJson(
    reservation.driverPort,
    "/setViewport",
    params,
  );
  return (result.cdpTargetId as string) ?? null;
}

/**
 * Set color scheme on the browser page without context recreation.
 */
export async function setColorScheme(
  reservation: WebBrowserReservation,
  colorScheme: "dark" | "light",
): Promise<void> {
  await postJson(reservation.driverPort, "/setColorScheme", { colorScheme });
}
