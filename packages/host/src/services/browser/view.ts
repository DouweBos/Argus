/**
 * The embedded browser's command surface: pool reservation, screencast, and
 * input/navigation forwarded to Conductor. Session ids with no reservation are
 * ignored — the view may have been torn down while a command was in flight.
 */

import type { WebBrowserReservation } from "../../state";
import { emitHostEvent } from "@argus/host/bus";
import { appState } from "../../state";
import {
  restartScreencast,
  startScreencast,
  stopScreencast,
} from "./cdpScreencast";
import {
  type BrowserPreset,
  type NavState,
  goBack,
  goForward,
  keyboardEvent,
  mouseEvent,
  navigate,
  reload,
  setViewport,
  wheelEvent,
} from "./conductorInput";
import { webBrowserPool } from "./pool";

function emitNavState(sessionId: string, nav: NavState): void {
  emitHostEvent("browser_view:nav", {
    sessionId,
    url: nav.url,
    canGoBack: nav.canGoBack,
    canGoForward: nav.canGoForward,
  });
}

export async function browserViewEnsure(sessionId: string): Promise<void> {
  let reservation = webBrowserPool.getReservation(sessionId);
  if (!reservation) {
    reservation = await webBrowserPool.acquireBrowser(sessionId);
  }
  appState.browserSessions.set(sessionId, {
    id: sessionId,
    url: "",
    webContentsId: null,
  });
  await startScreencast(
    sessionId,
    reservation.cdpPort,
    reservation.cdpTargetId,
    {
      maxWidth: 1440,
      maxHeight: 900,
    },
  );
  emitHostEvent("browser:ensure_mounted", { sessionId });
}

export async function browserViewDestroy(sessionId: string): Promise<void> {
  await stopScreencast(sessionId);
  appState.browserSessions.delete(sessionId);
  await webBrowserPool.releaseBrowser(sessionId);
}

async function navigateWith(
  sessionId: string,
  go: (reservation: WebBrowserReservation) => Promise<NavState>,
): Promise<void> {
  const reservation = webBrowserPool.getReservation(sessionId);
  if (!reservation) {
    return;
  }
  emitNavState(sessionId, await go(reservation));
}

export function browserViewNavigate(
  sessionId: string,
  url: string,
): Promise<void> {
  return navigateWith(sessionId, (r) => navigate(r, url));
}

export function browserViewBack(sessionId: string): Promise<void> {
  return navigateWith(sessionId, goBack);
}

export function browserViewForward(sessionId: string): Promise<void> {
  return navigateWith(sessionId, goForward);
}

export function browserViewReload(sessionId: string): Promise<void> {
  return navigateWith(sessionId, reload);
}

export async function browserMouseEvent(
  sessionId: string,
  type: "click" | "down" | "move" | "up",
  x: number,
  y: number,
  button?: "left" | "middle" | "right",
): Promise<void> {
  const reservation = webBrowserPool.getReservation(sessionId);
  if (reservation) {
    await mouseEvent(reservation, type, x, y, button);
  }
}

export async function browserKeyboardEvent(
  sessionId: string,
  type: "down" | "press" | "up",
  key: string,
): Promise<void> {
  const reservation = webBrowserPool.getReservation(sessionId);
  if (reservation) {
    await keyboardEvent(reservation, type, key);
  }
}

export async function browserWheelEvent(
  sessionId: string,
  x: number,
  y: number,
  deltaX: number,
  deltaY: number,
): Promise<void> {
  const reservation = webBrowserPool.getReservation(sessionId);
  if (reservation) {
    await wheelEvent(reservation, x, y, deltaX, deltaY);
  }
}

/** Resize the viewport; a recreated context gets a new target to screencast. */
export async function browserUpdatePreset(
  sessionId: string,
  preset: BrowserPreset,
): Promise<void> {
  const reservation = webBrowserPool.getReservation(sessionId);
  if (!reservation) {
    return;
  }

  const isMobile = preset.screenPosition === "mobile";
  const newTargetId = await setViewport(reservation, {
    width: preset.internalWidth,
    height: preset.internalHeight,
    userAgent: preset.userAgent,
    isMobile,
    deviceScaleFactor: isMobile ? 2 : 1,
  });

  if (newTargetId) {
    reservation.cdpTargetId = newTargetId;
    await restartScreencast(sessionId, reservation.cdpPort, newTargetId, {
      maxWidth: preset.internalWidth,
      maxHeight: preset.internalHeight,
    });
  }
}
