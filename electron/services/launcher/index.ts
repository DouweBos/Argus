/**
 * Global Session Launcher service.
 *
 * Owns one fullscreen-on-cursor-display BrowserWindow that paints both the
 * dim 20%-black capture backdrop and the centered launcher card. The window
 * itself is the area-capture surface; no separate overlay windows.
 *
 * Two trigger sources:
 *   1. Electron's `globalShortcut` API (default: `Cmd+Shift+Space`). Works
 *      out of the box without any OS permission prompt.
 *   2. The `argus-hotkey-bridge` Swift helper, which monitors raw NSEvents
 *      for a double-press of right Option. Requires Accessibility permission;
 *      degrades to "shortcut only" if the user denies or the helper fails.
 *
 * Both triggers eventually call `toggleLauncher()`.
 */

import {
  type BrowserWindow,
  app,
  globalShortcut,
  screen,
  shell,
  systemPreferences,
} from "electron";
import { createLogger } from "../../../app/lib/logger";
import { createLauncherWindow } from "../../launcherWindow";
import { loadAppSettings, saveAppSettings } from "../appSettings/store";
import {
  type HotkeyBridgeStatus,
  getHotkeyBridgeStatus,
  startHotkeyBridge,
} from "./hotkeyBridge";

const log = createLogger("launcher");

let launcherWindow: BrowserWindow | null = null;
let registeredAccelerator: string | null = null;
let stopBridge: (() => void) | null = null;
let enabled = false;
// `ready-to-show` fires before Vite's module graph (CSS modules in particular)
// has finished injecting styles, so the very first show flashes unstyled
// content — a fullscreen grey block over the desktop. Wait for the renderer
// to confirm via `markLauncherRendererReady` (called from React after first
// commit) before unhiding.
let rendererReady = false;
let pendingShow = false;

/** The default fallback accelerator; bare-modifier double-tap lives elsewhere. */
export const DEFAULT_LAUNCHER_ACCELERATOR = "CommandOrControl+Shift+Space";

/**
 * Open the launcher (creating the window if needed) or hide it if already
 * visible and focused. Idempotent — safe to call from menu items, IPC, or
 * the native hotkey bridge.
 */
export function toggleLauncher(): void {
  if (launcherWindow && !launcherWindow.isDestroyed()) {
    if (launcherWindow.isVisible() && launcherWindow.isFocused()) {
      launcherWindow.hide();

      return;
    }
    show();

    return;
  }

  launcherWindow = createLauncherWindow();
  rendererReady = false;
  pendingShow = false;
  launcherWindow.on("closed", () => {
    launcherWindow = null;
    rendererReady = false;
    pendingShow = false;
  });
  show();
}

/**
 * Called by the renderer (via the `launcher_ready` IPC) once React has
 * committed and the dim backdrop + card are painted. Releases any pending
 * `show()` queued during window creation.
 */
export function markLauncherRendererReady(): void {
  rendererReady = true;
  if (pendingShow && launcherWindow && !launcherWindow.isDestroyed()) {
    pendingShow = false;
    launcherWindow.show();
    launcherWindow.focus();
    forceRecomposite(launcherWindow);
  }
}

/**
 * macOS workaround: a freshly-shown transparent BrowserWindow keeps the
 * pre-styled opaque-white WebContents frame the WindowServer cached at create
 * time, so the first show looks like a fullscreen grey block (white + the
 * 20%-black backdrop). Toggling the bounds by 1px and back forces NSWindow to
 * invalidate that cache and present the current — correctly transparent —
 * frame. Subsequent shows already have a clean cache and don't need this.
 */
function forceRecomposite(win: BrowserWindow): void {
  const bounds = win.getBounds();
  win.setBounds({ ...bounds, width: bounds.width + 1 });
  win.setBounds(bounds);
}

/** Force-show the launcher (no toggle). */
export function showLauncher(): void {
  if (!launcherWindow || launcherWindow.isDestroyed()) {
    toggleLauncher();

    return;
  }
  show();
}

function show(): void {
  if (!launcherWindow || launcherWindow.isDestroyed()) {
    return;
  }
  if (!rendererReady) {
    pendingShow = true;

    return;
  }
  launcherWindow.show();
  launcherWindow.focus();
  forceRecomposite(launcherWindow);
}

/** Hide the launcher window. */
export function hideLauncher(): void {
  if (launcherWindow && !launcherWindow.isDestroyed()) {
    launcherWindow.hide();
  }
}

/**
 * Hide the launcher window without sending a renderer-side teardown signal.
 * Used by the area-capture flow to drop the window out of the screenshot
 * frame; the launcher is `show()`n again immediately after.
 */
export function hideLauncherWindowOnly(): void {
  if (launcherWindow && !launcherWindow.isDestroyed()) {
    launcherWindow.hide();
  }
}

/**
 * Register the fallback `globalShortcut` accelerator. Re-registers on change.
 * Returns the accelerator that ended up registered (may differ from the
 * requested one if the requested one was already taken by another app).
 */
export function setLauncherAccelerator(
  accelerator: string | null,
): string | null {
  if (registeredAccelerator) {
    try {
      globalShortcut.unregister(registeredAccelerator);
    } catch {
      // ignore — best-effort cleanup
    }
    registeredAccelerator = null;
  }

  if (!accelerator) {
    return null;
  }

  try {
    const ok = globalShortcut.register(accelerator, () => {
      toggleLauncher();
    });
    if (ok) {
      registeredAccelerator = accelerator;

      return accelerator;
    }
    log.warn("globalShortcut.register returned false for %s", accelerator);
  } catch (e) {
    log.error("globalShortcut.register threw for %s:", accelerator, e);
  }

  return null;
}

/** Wired from `app.whenReady` in main.ts. */
export function initLauncher(): void {
  enabled = loadAppSettings().launcher_enabled === true;
  if (enabled) {
    activate();
  }
  app.on("will-quit", () => {
    deactivate();
  });
}

function activate(): void {
  setLauncherAccelerator(DEFAULT_LAUNCHER_ACCELERATOR);
  // Surface the macOS Accessibility prompt from the Electron main process so
  // the dialog identifies Argus.app (not the unsigned helper child) as the
  // requestor. Without this, the helper's own `AXIsProcessTrustedWithOptions`
  // call silently returns false — the OS won't dialog for an ad-hoc child
  // binary, so the user has no way to grant permission until they manage to
  // open the launcher some other way (e.g. Cmd+Shift+Space). Calling here
  // means enabling the launcher is enough to trigger the prompt.
  if (process.platform === "darwin") {
    try {
      systemPreferences.isTrustedAccessibilityClient(true);
    } catch (e) {
      log.warn("isTrustedAccessibilityClient threw:", e);
    }
  }
  // Native bridge for double-press right Option. Returns null on non-mac
  // or when the binary is missing — the Cmd+Shift+Space chord still works.
  const bridge = startHotkeyBridge(() => {
    toggleLauncher();
  });
  if (bridge) {
    stopBridge = bridge.stop;
  }
}

function deactivate(): void {
  if (registeredAccelerator) {
    try {
      globalShortcut.unregister(registeredAccelerator);
    } catch {
      // ignore
    }
    registeredAccelerator = null;
  }
  if (stopBridge) {
    stopBridge();
    stopBridge = null;
  }
  if (launcherWindow && !launcherWindow.isDestroyed()) {
    launcherWindow.close();
  }
  launcherWindow = null;
}

/**
 * Persist the on/off state and (de)activate the global shortcut + bridge.
 * Wired through the `set_launcher_enabled` IPC and the onboarding step.
 */
export function setLauncherEnabled(next: boolean): boolean {
  saveAppSettings({ launcher_enabled: next });
  if (next === enabled) {
    return enabled;
  }
  enabled = next;
  if (next) {
    activate();
  } else {
    deactivate();
  }

  return enabled;
}

export function isLauncherEnabled(): boolean {
  return enabled;
}

/** Read the latest cached bridge status — for the Settings dialog. */
export function launcherStatus(): HotkeyBridgeStatus & { enabled: boolean } {
  return { ...getHotkeyBridgeStatus(), enabled };
}

/** Get the launcher's current display id (for area-capture cropping). */
export function launcherDisplayId(): number | null {
  if (!launcherWindow || launcherWindow.isDestroyed()) {
    return null;
  }
  const bounds = launcherWindow.getBounds();
  const display = screen.getDisplayMatching(bounds);

  return display.id;
}

/**
 * Deep-link into macOS System Settings → Privacy & Security → Accessibility
 * so the user can grant Argus the permission needed by the right-Option
 * helper. No-op on non-mac.
 */
export function openAccessibilitySettings(): void {
  if (process.platform !== "darwin") {
    return;
  }
  shell
    .openExternal(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    )
    .catch((e) => log.warn("openExternal Accessibility failed:", e));
}
