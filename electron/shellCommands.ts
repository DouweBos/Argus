/**
 * The desktop shell's own commands: windows, popouts, dialogs, the updater and
 * Handoff. Everything else is served by the host core (`registerHostCommands`).
 * Typed by the same catalog, so these are schema-checked like the rest.
 */

import type { PopoutPlatform } from "@argus/remote-protocol";
import type { BrowserWindow } from "electron";
import {
  Menu,
  app,
  clipboard,
  dialog,
  nativeImage,
  systemPreferences,
} from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { emitHostEvent } from "@argus/host/bus";
import { ensureExt, inferImageExt } from "@argus/host/lib/imageFile";
import { createLogger } from "@argus/host/logger";
import { stopAgentsForQuit } from "@argus/host/services/agent/quit";
import { defineTypedCommand } from "@argus/host/services/command/registry";
import {
  listAndroidDevices,
  startAndroidCapture,
} from "@argus/host/services/simulator/android";
import {
  listSimulators,
  startSimulatorCapture,
} from "@argus/host/services/simulator/ios";
import { appState } from "@argus/host/state";
import { getMainWindow } from "./mainWindow";
import { agentPopouts } from "./popouts";
import { publishActivity } from "./services/continuity";
import {
  checkForUpdates,
  downloadUpdate,
  getUpdaterState,
  quitAndInstallUpdate,
} from "./services/updater";

/** Window plumbing that lives in `main.ts`, handed in to avoid an import cycle. */
export interface ShellWindows {
  createFloatingDeviceWindow: (options: {
    platform: PopoutPlatform;
    deviceKey: string;
    deviceName: string;
    runtime: string;
    online: boolean;
    capturing: boolean;
  }) => BrowserWindow;
  closeFloatingDeviceWindow: (
    platform: PopoutPlatform,
    deviceKey: string,
  ) => void;
  createFloatingAgentWindow: (options: {
    agentId: string;
    sessionId: string;
    title?: string;
    cursorX?: number;
    cursorY?: number;
  }) => BrowserWindow;
  closeFloatingAgentWindow: (agentId: string) => void;
  /** Lets the next `before-quit` past the running-agents guard. */
  markQuitConfirmedDespiteAgents: () => void;
}

async function resolveNativeImage(
  src: string,
): Promise<Electron.NativeImage | null> {
  if (src.startsWith("data:")) {
    return nativeImage.createFromDataURL(src);
  }
  if (src.startsWith("file://")) {
    return nativeImage.createFromPath(
      decodeURIComponent(new URL(src).pathname),
    );
  }
  if (src.startsWith("/")) {
    return nativeImage.createFromPath(src);
  }
  if (src.startsWith("http:") || src.startsWith("https:")) {
    const res = await fetch(src);

    return nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()));
  }

  return null;
}

/**
 * Open a device in its own window. Holds a capture reference so the stream
 * survives the main window switching away — but only for a device that is up,
 * since capturing a shut-down simulator hides the popout's own Boot button.
 */
async function openDevicePopout(
  windows: ShellWindows,
  platform: PopoutPlatform,
  deviceKey: string,
  name: string | undefined,
): Promise<void> {
  let deviceName = name ?? "Device";
  let runtime = "";
  let online = platform === "video";
  let capturing = false;

  if (platform === "ios") {
    const devices = await listSimulators().catch(() => []);
    const device = devices.find((d) => d.udid === deviceKey);
    const active = appState.simulators.get(deviceKey);
    deviceName = active?.deviceName ?? device?.name ?? deviceName;
    runtime = device?.runtime ?? "";
    online = device?.booted ?? false;
    if (online) {
      capturing = await startSimulatorCapture(deviceKey)
        .then(() => true)
        .catch(() => false);
    }
  } else if (platform === "android") {
    const devices = await listAndroidDevices().catch(() => []);
    const device = devices.find((d) => d.serial === deviceKey);
    deviceName = device?.name ?? deviceName;
    online = device?.online ?? false;
    if (online) {
      capturing = await startAndroidCapture(deviceKey)
        .then(() => true)
        .catch(() => false);
    }
  }

  windows.createFloatingDeviceWindow({
    platform,
    deviceKey,
    deviceName,
    runtime,
    online,
    capturing,
  });
}

async function showImageContextMenu(
  src: string,
  suggestedName: string,
): Promise<void> {
  const win = getMainWindow();
  if (!win) {
    return;
  }
  const image = await resolveNativeImage(src);
  if (!image || image.isEmpty()) {
    return;
  }
  const ext = inferImageExt(src, suggestedName);
  Menu.buildFromTemplate([
    {
      label: "Copy Image",
      click: () => clipboard.writeImage(image),
    },
    {
      label: "Save Image As…",
      click: async () => {
        const result = await dialog.showSaveDialog(win, {
          defaultPath: ensureExt(suggestedName, ext),
          filters: [
            {
              name: "Images",
              extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"],
            },
          ],
        });
        if (result.canceled || !result.filePath) {
          return;
        }
        const outExt = path.extname(result.filePath).toLowerCase();
        const buffer =
          outExt === ".jpg" || outExt === ".jpeg"
            ? image.toJPEG(95)
            : image.toPNG();
        await fs.writeFile(result.filePath, buffer);
      },
    },
  ]).popup({ window: win });
}

/** Ensure macOS camera (capture-card) access for the video-input viewer. */
async function requestCameraAccess(): Promise<
  "denied" | "granted" | "not-determined" | "restricted" | "unknown"
> {
  if (process.platform !== "darwin") {
    return "granted";
  }
  const status = systemPreferences.getMediaAccessStatus("camera");
  // Only "not-determined" can prompt; "denied"/"restricted" must be changed
  // in System Settings and would otherwise hang here.
  if (status !== "not-determined") {
    return status;
  }

  return (await systemPreferences.askForMediaAccess("camera"))
    ? "granted"
    : "denied";
}

export function registerShellCommands(windows: ShellWindows): void {
  defineTypedCommand("close_window", () => {
    getMainWindow()?.close();
  });

  // The renderer accepted the prompt surfaced via `app:quit-request`;
  // `app.quit()` re-enters `before-quit` with the guard flag set.
  defineTypedCommand("app_confirm_quit", async () => {
    await stopAgentsForQuit();
    windows.markQuitConfirmedDespiteAgents();
    app.quit();
  });
  // `before-quit` already prevented the quit; nothing to undo.
  defineTypedCommand("app_cancel_quit", () => {
    createLogger("ipc:app_cancel_quit").info("user cancelled quit");
  });

  defineTypedCommand("updater_get_state", () => getUpdaterState());
  defineTypedCommand("updater_check", (p) =>
    checkForUpdates({ silent: p.silent === true }),
  );
  defineTypedCommand("updater_download", () => downloadUpdate());
  defineTypedCommand("updater_quit_and_install", () => {
    quitAndInstallUpdate();
  });

  defineTypedCommand("open_device_popout", (p) =>
    openDevicePopout(windows, p.platform, p.deviceKey, p.name),
  );
  defineTypedCommand("close_device_popout", (p) => {
    windows.closeFloatingDeviceWindow(p.platform, p.deviceKey);
  });

  defineTypedCommand("open_agent_popout", (p) => {
    windows.createFloatingAgentWindow(p);
    // Every window (the requester included) hides the agent from its tab bar.
    emitHostEvent("agent:popout-opened", {
      agentId: p.agentId,
      sessionId: p.sessionId,
    });
  });
  // The window's `closed` handler broadcasts `agent:popout-closed`.
  defineTypedCommand("close_agent_popout", (p) => {
    windows.closeFloatingAgentWindow(p.agentId);
  });
  defineTypedCommand("list_popped_out_agents", () => [...agentPopouts.keys()]);

  // The renderer knows what is on screen; the main process owns the
  // NSUserActivity that advertises it to the phone.
  defineTypedCommand("publish_handoff", ({ sessionId, ...rest }) =>
    publishActivity(sessionId ? { sessionId, ...rest } : null),
  );

  defineTypedCommand("request_camera_access", () => requestCameraAccess());
  defineTypedCommand("show_image_context_menu", (p) =>
    showImageContextMenu(p.src, p.suggestedName || "image.png"),
  );
  defineTypedCommand("show_open_dialog", async (p) => {
    const win = getMainWindow();
    if (!win) {
      return null;
    }
    const result = await dialog.showOpenDialog(win, {
      properties: ["openDirectory"],
      title: p.title ?? "Select Repository Root",
    });

    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
}
