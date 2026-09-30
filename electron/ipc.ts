/**
 * IPC command registration — routes commands to service functions.
 *
 * Every command is declared through `defineCommand` (via the local `handle`
 * helpers), which owns the registry entry; `ipcBridge.ts` publishes it on IPC.
 * Each handler unwraps the args object and delegates to the appropriate service.
 * Errors thrown in handlers automatically reject the renderer's promise
 * (errors are thrown as plain strings).
 */

import type { CommandTier } from "@argus/host/services/command/registry";
import type { ToolId } from "@argus/host/services/tools/types";
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
import { stopAgent } from "@argus/host/services/agent/claude";
import { defineCommand } from "@argus/host/services/command/registry";
import {
  listAndroidDevices,
  startAndroidCapture,
} from "@argus/host/services/simulator/android";
import {
  listSimulators,
  startSimulatorCapture,
} from "@argus/host/services/simulator/ios";
import { toolEnabled } from "@argus/host/services/tools/state";
import { appState } from "@argus/host/state";
import { createLogger } from "../app/lib/logger";
import {
  closeFloatingAgentWindow,
  closeFloatingDeviceWindow,
  createFloatingAgentWindow,
  createFloatingDeviceWindow,
  getMainWindow,
  markQuitConfirmedDespiteAgents,
} from "./main";
import { agentPopouts } from "./popouts";
import { publishActivity } from "./services/continuity";
import {
  checkForUpdates as updaterCheck,
  downloadUpdate as updaterDownload,
  getUpdaterState,
  quitAndInstallUpdate,
} from "./services/updater";

type Args = Record<string, unknown>;

async function resolveNativeImage(
  src: string,
): Promise<Electron.NativeImage | null> {
  if (src.startsWith("data:")) {
    return nativeImage.createFromDataURL(src);
  }
  if (src.startsWith("file://")) {
    const url = new URL(src);

    return nativeImage.createFromPath(decodeURIComponent(url.pathname));
  }
  if (src.startsWith("/")) {
    return nativeImage.createFromPath(src);
  }
  if (src.startsWith("http:") || src.startsWith("https:")) {
    const res = await fetch(src);
    const buf = Buffer.from(await res.arrayBuffer());

    return nativeImage.createFromBuffer(buf);
  }

  return null;
}

function inferImageExt(src: string, fallbackName: string): string {
  const m = src.match(/^data:image\/([a-zA-Z0-9+.-]+);/);
  if (m) {
    const t = m[1].toLowerCase();
    if (t === "jpeg") {
      return "jpg";
    }

    return t;
  }
  const ext = path.extname(fallbackName).replace(".", "").toLowerCase();

  return ext || "png";
}

function ensureExt(name: string, ext: string): string {
  if (path.extname(name)) {
    return name;
  }

  return `${name}.${ext}`;
}

/**
 * Helper: register a tool-gated handler. The body only runs when the
 * specified tool is currently enabled; otherwise the IPC call rejects with
 * "tool disabled". UI surfaces that depend on a tool are filtered upstream
 * via `useEffectiveToolEnabled`, so this is defense-in-depth — it also
 * stops other agents/scripts that hold a renderer handle from poking at
 * disabled features.
 */
function toolHandle(
  channel: string,
  tier: CommandTier,
  toolId: ToolId,
  handler: (args: Args) => Promise<unknown> | unknown,
): void {
  handle(channel, tier, (args) => {
    if (!toolEnabled(toolId)) {
      throw `tool disabled: ${toolId}`;
    }

    return handler(args);
  });
}

/** Helper: register a command in the registry, which publishes it on IPC. */
function handle(
  channel: string,
  tier: CommandTier,
  handler: (args: Args) => Promise<unknown> | unknown,
): void {
  defineCommand(channel, { tier, handler });
}

export function registerIpcHandlers(): void {
  // Window
  handle("close_window", "host", () => {
    getMainWindow()?.close();
  });

  // Quit-with-running-agents flow. Invoked by the renderer after the user
  // accepts the confirm dialog surfaced via `app:quit-request`. Stops each
  // running agent (best-effort, bounded by a short timeout) and then calls
  // app.quit(), which re-enters `before-quit` with the guard flag set.
  handle("app_confirm_quit", "admin", async () => {
    const runningIds: string[] = [];
    for (const [id, session] of appState.agents) {
      if (session.status === "running") {
        runningIds.push(id);
      }
    }

    const logger = createLogger("ipc:app_confirm_quit");
    logger.info(`stopping ${runningIds.length} running agents before quit`);

    // Run all stops with a short per-call timeout so a stuck agent can't hang
    // the quit. Failures are logged and ignored — we proceed with quit.
    await Promise.allSettled(
      runningIds.map(async (id) => {
        try {
          await Promise.race([
            stopAgent(id),
            new Promise<void>((resolve) => setTimeout(resolve, 1500)),
          ]);
        } catch (err) {
          logger.error(`stopAgent(${id}) threw during quit:`, err);
        }
      }),
    );

    markQuitConfirmedDespiteAgents();
    app.quit();
  });

  // Renderer cancelled the quit prompt — nothing to do server-side; the
  // `before-quit` handler already called `event.preventDefault()`.
  handle("app_cancel_quit", "admin", () => {
    createLogger("ipc:app_cancel_quit").info("user cancelled quit");
  });

  // Auto-updater
  handle("updater_get_state", "admin", () => getUpdaterState());
  handle("updater_check", "host", (a) =>
    updaterCheck({ silent: a.silent === true }),
  );
  handle("updater_download", "host", () => updaterDownload());
  handle("updater_quit_and_install", "host", () => {
    quitAndInstallUpdate();
  });

  // Session CRUD

  toolHandle("open_device_popout", "admin", "device-recording", async (a) => {
    const platform = a.platform as "android" | "ios" | "video";
    const deviceKey = a.deviceKey as string;

    let deviceName = (a.name as string | undefined) ?? "Device";
    let runtime = "";
    let online = platform === "video";
    // Acquire a capture reference so the stream survives the main window
    // switching away from this device. Only for a device that's actually up —
    // capturing a shut-down simulator hides the popout's own Boot button and
    // leaves the user with an empty frame and no way out.
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

    createFloatingDeviceWindow({
      platform,
      deviceKey,
      deviceName,
      runtime,
      online,
      capturing,
    });
  });
  toolHandle("close_device_popout", "admin", "device-recording", (a) => {
    closeFloatingDeviceWindow(
      a.platform as "android" | "ios" | "video",
      a.deviceKey as string,
    );

    return Promise.resolve();
  });

  handle("open_agent_popout", "host", (a) => {
    const agentId = a.agentId as string;
    const sessionId = a.sessionId as string;
    const title = typeof a.title === "string" ? (a.title as string) : undefined;
    const cursorX =
      typeof a.cursorX === "number" ? (a.cursorX as number) : undefined;
    const cursorY =
      typeof a.cursorY === "number" ? (a.cursorY as number) : undefined;
    createFloatingAgentWindow({
      agentId,
      sessionId,
      title,
      cursorX,
      cursorY,
    });
    // Broadcast so every window (including the one that requested it) can
    // hide the agent from its tab bar in sync.
    emitHostEvent("agent:popout-opened", { agentId, sessionId });

    return Promise.resolve();
  });
  handle("close_agent_popout", "host", (a) => {
    const agentId = a.agentId as string;
    closeFloatingAgentWindow(agentId);
    // The window's `closed` handler broadcasts `agent:popout-closed`; nothing
    // more to do here.

    return Promise.resolve();
  });
  // Handoff — the renderer owns "what am I looking at", the main process owns
  // the NSUserActivity that advertises it to the phone.
  handle("publish_handoff", "host", (a) => {
    const sessionId = a.sessionId as string | null;

    return publishActivity(
      sessionId
        ? {
            sessionId,
            agentId: a.agentId as string | undefined,
            label: a.label as string | undefined,
            projectName: a.projectName as string | undefined,
            repoRoot: a.repoRoot as string | undefined,
          }
        : null,
    );
  });

  handle("list_popped_out_agents", "admin", () =>
    Promise.resolve(Array.from(agentPopouts.keys())),
  );

  // Video-input viewer — ensure macOS camera (capture-card) access is granted.
  // Returns the resulting TCC status so the renderer can surface it.
  handle("request_camera_access", "admin", async () => {
    if (process.platform !== "darwin") {
      return "granted";
    }
    const status = systemPreferences.getMediaAccessStatus("camera");
    if (status === "granted") {
      return "granted";
    }
    // Only "not-determined" can prompt; "denied"/"restricted" must be changed
    // in System Settings and would otherwise hang here.
    if (status !== "not-determined") {
      return status;
    }
    const granted = await systemPreferences.askForMediaAccess("camera");

    return granted ? "granted" : "denied";
  });

  // Image context menu
  handle("show_image_context_menu", "host", async (a) => {
    const win = getMainWindow();
    if (!win) {
      return;
    }
    const src = a.src as string;
    const suggestedName = (a.suggestedName as string) || "image.png";
    const image = await resolveNativeImage(src);
    if (!image || image.isEmpty()) {
      return;
    }
    const ext = inferImageExt(src, suggestedName);
    const menu = Menu.buildFromTemplate([
      {
        label: "Copy Image",
        click: () => {
          clipboard.writeImage(image);
        },
      },
      {
        label: "Save Image As\u2026",
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
    ]);
    menu.popup({ window: win });
  });

  // Dialog
  handle("show_open_dialog", "host", async (a) => {
    const win = getMainWindow();
    if (!win) {
      return null;
    }
    const title = (a?.title as string | undefined) ?? "Select Repository Root";
    const result = await dialog.showOpenDialog(win, {
      properties: ["openDirectory"],
      title,
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

}
