/**
 * Floating launcher BrowserWindow factory.
 *
 * Loads the renderer with `?popout=launcher` (see `app/main.tsx`), which
 * mounts the `LauncherPopout` React tree.
 */

import { BrowserWindow, app, screen } from "electron";
import path from "node:path";

const VITE_DEV_URL =
  process.env.VITE_DEV_SERVER_URL ??
  `http://localhost:${process.env.ARGUS_PORT ?? "1420"}`;

/**
 * The launcher is one big transparent BrowserWindow that covers the whole
 * display where the cursor lives. The renderer paints a 20%-black backdrop
 * over the entire window and floats an opaque "card" inside it. That backdrop
 * is also the area-capture surface — drag anywhere outside the card to
 * marquee a rectangle.
 */
export function createLauncherWindow(): BrowserWindow {
  const isDev = !app.isPackaged;
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);

  const win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    focusable: true,
    // NSPanel-style window: can become key (accept keyboard) without
    // activating the Argus app process. Without this, `show()` + `focus()`
    // activates Argus, which on macOS pulls the user back to whatever Space
    // the main window lives on — breaking the launcher when summoned from a
    // fullscreen app, and re-showing the main window on first invocation.
    type: process.platform === "darwin" ? "panel" : undefined,
    // `transparent: true` alone leaves the WebContents at its default opaque
    // white. The `.backdrop` element paints `rgba(0,0,0,0.2)` over that and
    // the user sees light grey (255×0.8 ≈ 204 = #CCC) instead of the desktop.
    // Setting `backgroundColor` to a fully-transparent hex makes the
    // WebContents itself transparent so the dim layer composites correctly.
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  // Float over fullscreen apps too — the user can be in a fullscreen IDE
  // and still summon the launcher.
  try {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch {
    // not supported on all platforms — ignore
  }
  win.setAlwaysOnTop(true, "floating");

  const params = new URLSearchParams({
    popout: "launcher",
    displayId: String(display.id),
  });

  if (isDev) {
    win.loadURL(`${VITE_DEV_URL}?${params.toString()}`);
  } else {
    const indexPath = path.join(__dirname, "../dist/index.html");
    win.loadFile(indexPath, { search: `?${params.toString()}` });
  }

  return win;
}
