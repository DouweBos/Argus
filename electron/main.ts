/**
 * Electron main process entry point.
 *
 * Creates the BrowserWindow, loads the Vite dev server (dev) or bundled
 * index.html (prod), and wires up IPC handlers.
 */

import {
  app,
  BrowserWindow,
  Menu,
  MenuItem,
  nativeImage,
  nativeTheme,
  net,
  protocol,
  session,
  shell,
} from "electron";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  startHost,
  stopHostServices,
  syncHostCleanup,
  terminateHostProcesses,
} from "@argus/host/boot";
import { emitHostEvent } from "@argus/host/bus";
import { argusHomeDir } from "@argus/host/lib/argusHome";
import { writeLogLine } from "@argus/host/lib/logFile";
import { isServerMode, startPowerAssertion } from "@argus/host/serverMode";
import { setColorScheme } from "@argus/host/services/browser/conductorInput";
import { LOCAL_GATEWAY_PORT } from "@argus/host/services/remote/remoteService";
import { refreshAllBranches } from "@argus/host/services/session/watcher";
import { stopAndroidCapture } from "@argus/host/services/simulator/android";
import { stopSimulatorCapture } from "@argus/host/services/simulator/ios";
import { getVideoDims } from "@argus/host/services/simulator/videoForward";
import { appState } from "@argus/host/state";
import { log as emitLog } from "../app/lib/logger";
import { installRendererEventSink } from "./broadcast";
import { installCrashHooks } from "./crashHooks";
import { startDevTrust, stopDevTrust } from "./devTrust";
import { claimHostLock, reportHostLockHandover } from "./hostLockGate";
import { installHostPlatform } from "./hostPlatform";
import { installIpcCommandBridge } from "./ipcBridge";
import { setMainWindow } from "./mainWindow";
import { agentPopouts, devicePopouts } from "./popouts";
import { initServerUpdates } from "./serverUpdates";
import { initContinuity } from "./services/continuity";
import { nudgeForFullDiskAccess } from "./services/fullDiskAccess";
import { destroyTray, initTray } from "./services/tray";
import {
  checkForUpdates,
  initUpdater,
  setBeforeQuitAndInstallHook,
} from "./services/updater";
import { registerShellCommands } from "./shellCommands";

// Remote debugging port is no longer needed — Conductor now owns the browser
// and Argus connects via CDP to Conductor's Chromium instance.

// Register custom protocols as privileged before app is ready.
// This lets the renderer fetch session images via URL.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "argus-file",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true,
    },
  },
]);

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (process.platform === "win32") {
  app.setAppUserModelId(app.getName());
}

// In dev, isolate userData from the installed Argus.app so the two can run
// side-by-side. The single-instance lock lives under userData, so sharing it
// makes `pnpm dev` silently quit (exit 0) whenever the packaged app is open.
if (!app.isPackaged) {
  const devUserData = path.join(
    app.getPath("appData"),
    isServerMode() ? "argus-server-dev" : "argus-dev",
  );
  app.setPath("userData", devUserData);
}

let mainWindow: BrowserWindow | null = null;
let pendingDeepLink: string | null = null;

const isDev = !app.isPackaged;

/** Resolve the app icon file for the current environment. */
function resolveAppIconPath(): string | null {
  const candidates = isDev
    ? [
        path.join(__dirname, "..", "build", "icon.png"),
        path.join(__dirname, "..", "..", "build", "icon.png"),
      ]
    : [
        path.join(process.resourcesPath, "icon.png"),
        path.join(app.getAppPath(), "build", "icon.png"),
      ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

/** Resolve the built LAN web client directory, or null if it isn't present. */
function resolveWebClientDir(): string | null {
  const candidates = isDev
    ? [
        path.join(__dirname, "..", "clients", "argus-web", "dist"),
        path.join(__dirname, "..", "..", "clients", "argus-web", "dist"),
      ]
    : [path.join(process.resourcesPath, "argus-web")];
  for (const p of candidates) {
    if (fs.existsSync(path.join(p, "index.html"))) {
      return p;
    }
  }

  return null;
}

/**
 * Resolve a menu-bar icon by base name (e.g. `check-for-updatesTemplate.png`).
 * Lives in `build/menu-icons/` in dev and is shipped via `extraResources` in
 * packaged builds. Returns `null` so callers can degrade to a label-only menu
 * item if the asset goes missing.
 */
function resolveMenuIconPath(filename: string): string | null {
  const candidates = isDev
    ? [
        path.join(__dirname, "..", "build", "menu-icons", filename),
        path.join(__dirname, "..", "..", "build", "menu-icons", filename),
      ]
    : [
        path.join(process.resourcesPath, "menu-icons", filename),
        path.join(app.getAppPath(), "build", "menu-icons", filename),
      ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

// `argus://sessions/<id>/git` — register as this app's protocol handler so
// external callers (MCP, Slack previews, custom URL openers) can jump straight
// into a screen. Uses setAsDefaultProtocolClient; the actual URL is received
// via `open-url` (macOS) or the `second-instance` argv on Linux/Windows.
// Skipped on the server: claiming the scheme there would steal `argus://`
// links from the desktop app on the same Mac.
if (!isServerMode() && !app.isDefaultProtocolClient("argus")) {
  app.setAsDefaultProtocolClient("argus");
}

/** Turn an `argus://...` URL into an in-app pathname. */
function deepLinkToPath(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "argus:") {
      return null;
    }
    // argus://sessions/abc/git → /sessions/abc/git
    const host = u.hostname ? `/${u.hostname}` : "";
    const pathname = u.pathname || "";

    return `${host}${pathname}` || "/";
  } catch {
    return null;
  }
}

function deliverDeepLink(url: string): void {
  const target = deepLinkToPath(url);
  if (!target) {
    return;
  }
  if (mainWindow && mainWindow.webContents.isLoading() === false) {
    mainWindow.webContents.send("navigation:goto", { path: target });
    mainWindow.show();
    mainWindow.focus();
  } else {
    pendingDeepLink = target;
  }
}

/**
 * Bring the window up on a route. Shared by the tray and by Handoff: both are
 * "something outside the window decided what you should be looking at".
 */
function navigateMainWindow(route: string, agentId?: string): void {
  if (isServerMode()) {
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }
  mainWindow?.show();
  mainWindow?.focus();
  if (mainWindow?.webContents.isLoading()) {
    pendingDeepLink = route;
  } else {
    mainWindow?.webContents.send("navigation:goto", {
      path: route,
      agentId,
    });
  }
}

app.on("open-url", (e, url) => {
  e.preventDefault();
  deliverDeepLink(url);
});

const singleInstanceOk = app.requestSingleInstanceLock();
if (!singleInstanceOk) {
  app.quit();
}
app.on("second-instance", (_e, argv) => {
  const urlArg = argv.find((a) => a.startsWith("argus://"));
  if (urlArg) {
    deliverDeepLink(urlArg);
  } else if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});
// Prefer an explicit VITE_DEV_SERVER_URL, otherwise compose from ARGUS_PORT
// (set by the per-session `workspace_env` config so sibling worktrees don't
// all try to bind the same port). Fall back to Vite's default.
const VITE_DEV_URL =
  process.env.VITE_DEV_SERVER_URL ??
  `http://localhost:${process.env.ARGUS_PORT ?? "1420"}`;

// Tee main-process console.* to the rotating log file. In a bundled .app there
// is no attached terminal, so without this tee every console call across
// services (info/warn/error from app/lib/logger.ts) vanishes silently.
/* eslint-disable no-console -- this block is the central console tee for the main process */
const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};
console.log = (...args: unknown[]) => {
  writeLogLine("log", args);
  originalConsole.log(...args);
};
console.info = (...args: unknown[]) => {
  writeLogLine("info", args);
  originalConsole.info(...args);
};
console.warn = (...args: unknown[]) => {
  writeLogLine("warn", args);
  originalConsole.warn(...args);
};
console.error = (...args: unknown[]) => {
  writeLogLine("error", args);
  originalConsole.error(...args);
};
console.debug = (...args: unknown[]) => {
  writeLogLine("debug", args);
  originalConsole.debug(...args);
};
/* eslint-enable no-console */

process.on("uncaughtException", (err, origin) => {
  writeLogLine("fatal", [`uncaughtException (${origin})`, err]);
});
process.on("unhandledRejection", (reason) => {
  writeLogLine("fatal", ["unhandledRejection", reason]);
});

/** Write a log line from the main module with structured formatting. */
export function logToFile(level: string, ...args: unknown[]): void {
  writeLogLine(level, args);
}

function log(msg: string, ...args: unknown[]): void {
  // Goes through the patched console.log → tees to file and terminal once.
  emitLog(`[Argus] ${msg}`, ...args);
}

/** Send a payload to the main window if it's alive. */
function sendToRenderer(channel: string, payload?: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send(channel, payload);
  }
}

/**
 * Build the application menu (macOS menu bar / Win+Linux window menu).
 *
 * Items that share a chord with a renderer-side global shortcut use
 * `registerAccelerator: false` — the chord is shown in the menu for
 * discoverability, but the renderer's keydown handler stays the single
 * source of truth so we don't double-fire.
 */
function buildAppMenu(): Menu {
  const isMac = process.platform === "darwin";
  const appName = app.getName();

  const goto = (route: string) =>
    sendToRenderer("navigation:goto", { path: route });
  const invoke = (id: string) => sendToRenderer("menu:invoke-shortcut", { id });

  // Template image (black on transparent, named `*Template.png`) so macOS
  // tints it for light/dark menu bars automatically. The matching `@2x`
  // variant lives next to it and is picked up by NativeImage on retina.
  const checkForUpdatesIconPath = resolveMenuIconPath(
    "check-for-updatesTemplate.png",
  );
  const checkForUpdatesIcon = checkForUpdatesIconPath
    ? nativeImage.createFromPath(checkForUpdatesIconPath)
    : undefined;
  if (checkForUpdatesIcon) {
    checkForUpdatesIcon.setTemplateImage(true);
  }

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: appName,
            submenu: [
              { role: "about" },
              {
                label: "Check for Updates…",
                icon: checkForUpdatesIcon,
                click: () => {
                  checkForUpdates({ silent: false }).catch(() => {});
                  invoke("updater-show");
                },
              },
              { type: "separator" },
              {
                label: "Settings…",
                accelerator: "CmdOrCtrl+,",
                registerAccelerator: false,
                click: () => invoke("settings"),
              },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ] as Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "New Session…",
          accelerator: "CmdOrCtrl+N",
          registerAccelerator: false,
          click: () => invoke("new-session"),
        },
        {
          label: "New Agent in Current Session",
          accelerator: "CmdOrCtrl+Shift+A",
          registerAccelerator: false,
          click: () => invoke("new-agent"),
        },
        { type: "separator" },
        {
          label: "Open Project…",
          accelerator: "CmdOrCtrl+O",
          registerAccelerator: false,
          click: () => invoke("open-repo"),
        },
        {
          label: "Open Project or Session…",
          accelerator: "CmdOrCtrl+Shift+O",
          registerAccelerator: false,
          click: () => invoke("open-palette"),
        },
        { type: "separator" },
        {
          label: "New Tab",
          accelerator: "CmdOrCtrl+T",
          registerAccelerator: false,
          click: () => invoke("new-tab"),
        },
        {
          label: "Close Tab",
          accelerator: "CmdOrCtrl+W",
          registerAccelerator: false,
          click: () => invoke("close-tab"),
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "App Home",
          accelerator: "CmdOrCtrl+Shift+H",
          registerAccelerator: false,
          click: () => invoke("go-home"),
        },
        {
          label: "Project Home",
          accelerator: "CmdOrCtrl+Alt+H",
          registerAccelerator: false,
          click: () => invoke("go-project-home"),
        },
        { type: "separator" },
        {
          label: "Agents",
          accelerator: "CmdOrCtrl+Alt+1",
          click: () => goto("/agents"),
        },
        {
          label: "Devices",
          accelerator: "CmdOrCtrl+Alt+2",
          click: () => goto("/devices"),
        },
        {
          label: "Runtimes",
          accelerator: "CmdOrCtrl+Alt+3",
          click: () => goto("/runtimes"),
        },
        {
          label: "Pull Requests",
          accelerator: "CmdOrCtrl+Alt+4",
          click: () => goto("/pull-requests"),
        },
        {
          label: "Notifications",
          accelerator: "CmdOrCtrl+Alt+5",
          click: () => goto("/notifications"),
        },
        { type: "separator" },
        {
          label: "Next Tab",
          accelerator: "Control+Tab",
          registerAccelerator: false,
          click: () => invoke("next-tab"),
        },
        {
          label: "Previous Tab",
          accelerator: "Control+Shift+Tab",
          registerAccelerator: false,
          click: () => invoke("prev-tab"),
        },
        { type: "separator" },
        {
          label: "Command Palette…",
          accelerator: "CmdOrCtrl+Shift+P",
          registerAccelerator: false,
          click: () => invoke("command-palette"),
        },
        { type: "separator" },
        {
          label: "Toggle Left Sidebar",
          accelerator: "CmdOrCtrl+B",
          registerAccelerator: false,
          click: () => invoke("toggle-left-sidebar"),
        },
        {
          label: "Toggle Right Panel",
          accelerator: "CmdOrCtrl+Alt+B",
          registerAccelerator: false,
          click: () => invoke("toggle-right-panel"),
        },
        {
          label: "Toggle Bottom Panel",
          accelerator: "CmdOrCtrl+J",
          registerAccelerator: false,
          click: () => invoke("toggle-bottom-panel"),
        },
        { type: "separator" },
        {
          label: "Toggle Terminal",
          accelerator: "CmdOrCtrl+Shift+T",
          registerAccelerator: false,
          click: () => invoke("toggle-terminal"),
        },
        {
          label: "Toggle Changes",
          accelerator: "CmdOrCtrl+Shift+G",
          registerAccelerator: false,
          click: () => invoke("toggle-changes"),
        },
        {
          label: "Toggle Simulator",
          accelerator: "CmdOrCtrl+Shift+M",
          registerAccelerator: false,
          click: () => invoke("toggle-simulator"),
        },
        {
          label: "Toggle Device Debugger",
          accelerator: "CmdOrCtrl+Shift+D",
          registerAccelerator: false,
          click: () => invoke("toggle-debug"),
        },
        { type: "separator" },
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? ([
              { type: "separator" },
              { role: "front" },
              { type: "separator" },
              { role: "window" },
            ] as Electron.MenuItemConstructorOptions[])
          : ([{ role: "close" }] as Electron.MenuItemConstructorOptions[])),
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

function createWindow(): void {
  log("createWindow: isDev=%s, __dirname=%s", isDev, __dirname);
  const iconPath = resolveAppIconPath();
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#15151c" : "#fafbfc",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 12 },
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  setMainWindow(mainWindow);

  // Allow the app's own renderers to use camera/mic (video-input viewer) while
  // NOT auto-granting media to arbitrary sites loaded in embedded browsers.
  // Matches any top-level app window — the main window and every popout — but
  // not embedded guests, whose webContents is never its window's top-level one.
  const isAppFrame = (wc: Electron.WebContents | null): boolean => {
    if (!wc) {
      return false;
    }
    const owner = BrowserWindow.fromWebContents(wc);

    return owner?.webContents.id === wc.id;
  };
  mainWindow.webContents.session.setPermissionRequestHandler(
    (wc, permission, callback) => {
      if (permission === "media") {
        callback(isAppFrame(wc));

        return;
      }
      callback(true);
    },
  );
  mainWindow.webContents.session.setPermissionCheckHandler((wc, permission) =>
    permission === "media" ? isAppFrame(wc) : true,
  );

  // Intercept Cmd+W before the OS menu accelerator fires so the renderer can
  // close an open agent tab first and only fall through to window close when
  // no agents remain. Calling preventDefault() on before-input-event cancels
  // the menu shortcut as well as the in-page keydown.
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (
      input.type === "keyDown" &&
      input.key.toLowerCase() === "w" &&
      input.meta &&
      !input.shift &&
      !input.alt &&
      !input.control
    ) {
      event.preventDefault();
      mainWindow?.webContents.send("menu:close-intent");
    }
  });

  // macOS: hide instead of close on Cmd+W / traffic light, but allow real quit.
  mainWindow.on("close", (e) => {
    log("window close event: isQuitting=%s", isQuitting);
    if (process.platform === "darwin" && !isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  // Show window once content is ready — avoids white flash.
  mainWindow.once("ready-to-show", () => {
    log("ready-to-show fired");
    mainWindow?.show();
    nudgeForFullDiskAccess(mainWindow).catch((e) =>
      log("nudgeForFullDiskAccess failed: %s", String(e)),
    );
  });

  mainWindow.webContents.on("did-finish-load", () => {
    log("did-finish-load: %s", mainWindow?.webContents.getURL());
    if (pendingDeepLink && mainWindow) {
      mainWindow.webContents.send("navigation:goto", {
        path: pendingDeepLink,
      });
      pendingDeepLink = null;
    }
    mainWindow?.webContents.send("window:fullscreen", {
      fullscreen: mainWindow.isFullScreen(),
    });
  });

  // Notify renderer when entering/leaving native macOS fullscreen so it can
  // collapse the traffic-light reservation in the title bar.
  mainWindow.on("enter-full-screen", () => {
    mainWindow?.webContents.send("window:fullscreen", { fullscreen: true });
  });
  mainWindow.on("leave-full-screen", () => {
    mainWindow?.webContents.send("window:fullscreen", { fullscreen: false });
  });

  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    log("did-fail-load: code=%d desc=%s url=%s", code, desc, url);
  });

  mainWindow.webContents.on(
    "console-message",
    (_e, level, message, line, sourceId) => {
      log("renderer [%d]: %s (source: %s:%d)", level, message, sourceId, line);
    },
  );

  // Open external links in the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);

    return { action: "deny" };
  });

  if (isDev) {
    log("loading dev URL: %s", VITE_DEV_URL);
    mainWindow.loadURL(VITE_DEV_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    const indexPath = path.join(__dirname, "../dist/index.html");
    log("loading production file: %s", indexPath);
    mainWindow.loadFile(indexPath);
  }
}

// macOS: keep process alive when all windows are closed (Cmd+W / traffic light).
app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && !isServerMode()) {
    app.quit();
  }
});

// macOS: Cmd+Q triggers before-quit before closing windows. Track it so
// window-all-closed (which fires after) knows not to keep the app alive.
let isQuitting = false;
/**
 * Set by `app_confirm_quit` IPC so the next `before-quit` bypasses the
 * running-agents guard. Cleared on `before-quit` entry.
 */
let bypassRunningAgentsGuard = false;

/** Called once the renderer has confirmed quit-with-running-agents. */
export function markQuitConfirmedDespiteAgents(): void {
  bypassRunningAgentsGuard = true;
}

app.on("before-quit", (e) => {
  if (isQuitting) {
    return;
  }

  const runningAgentIds: string[] = [];
  for (const [id, agentSession] of appState.agents) {
    if (agentSession.status === "running") {
      runningAgentIds.push(id);
    }
  }

  // The server has no renderer to answer the guard prompt, so it never asks.
  if (
    runningAgentIds.length > 0 &&
    !bypassRunningAgentsGuard &&
    !isServerMode()
  ) {
    log(
      "before-quit: %d running agents, asking renderer",
      runningAgentIds.length,
    );
    e.preventDefault();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send("app:quit-request", {
        runningCount: runningAgentIds.length,
      });
    }

    return;
  }

  // Past the guard — reset so a subsequent aborted quit is re-guarded.
  bypassRunningAgentsGuard = false;
  log("before-quit fired, setting isQuitting=true");
  isQuitting = true;
  stopHostServices();
  destroyTray();
  stopDevTrust();
  // Give the renderer a moment to save active conversations before destroying
  // the window. The renderer listens for `app:will-quit` and persists chat
  // history synchronously via IPC.
  if (mainWindow && !mainWindow.isDestroyed()) {
    e.preventDefault();
    mainWindow.webContents.send("app:will-quit");
  }
  // Tear down every PTY so run-commands (dev servers, Metro, watchers) and
  // any detached grandchildren they spawned don't linger after Argus exits.
  // Await the kill→onExit cycle so node-pty's spawn-helper shims actually
  // get reaped before we call app.quit() — otherwise they reparent to
  // launchd and accumulate over restarts.
  terminateHostProcesses().finally(() => {
    // Destroy the window directly to bypass any beforeunload handler — we
    // handle our own save state.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.destroy();
    }
    app.quit();
  });
});

// Fallback cleanup for shutdown paths that bypass `before-quit`:
// `window-all-closed` (non-macOS), POSIX signals, and uncaught exits.
app.on("will-quit", syncHostCleanup);
process.on("exit", syncHostCleanup);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(sig, () => {
    syncHostCleanup();
    // Re-raise default behavior so Electron exits.
    app.quit();
  });
}

// macOS: re-show window when dock icon is clicked.
app.on("activate", () => {
  if (isServerMode()) {
    return;
  }
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    mainWindow?.show();
    mainWindow?.focus();
  }
});

/**
 * Build the right-click context menu for editable text fields. Wired up to
 * every webContents the app creates (main window + agent/simulator popouts)
 * so misspellings can be corrected anywhere a textarea or input lives.
 *
 * Without a `context-menu` handler attached to a given webContents, Chromium
 * shows the default platform menu without our spellcheck additions — which is
 * why suggestions only worked in the main window before.
 */
function attachSpellcheckContextMenu(wc: Electron.WebContents): void {
  wc.session.setSpellCheckerEnabled(true);
  wc.session.setSpellCheckerLanguages(["en-US"]);
  wc.on("context-menu", (_e, params) => {
    if (!params.isEditable) {
      return;
    }
    const menu = new Menu();
    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions) {
        menu.append(
          new MenuItem({
            label: suggestion,
            click: () => wc.replaceMisspelling(suggestion),
          }),
        );
      }
      if (params.dictionarySuggestions.length === 0) {
        menu.append(new MenuItem({ label: "No suggestions", enabled: false }));
      }
      menu.append(new MenuItem({ type: "separator" }));
      menu.append(
        new MenuItem({
          label: "Add to Dictionary",
          click: () =>
            wc.session.addWordToSpellCheckerDictionary(params.misspelledWord),
        }),
      );
      menu.append(new MenuItem({ type: "separator" }));
    }
    menu.append(new MenuItem({ role: "undo" }));
    menu.append(new MenuItem({ role: "redo" }));
    menu.append(new MenuItem({ type: "separator" }));
    menu.append(new MenuItem({ role: "cut" }));
    menu.append(new MenuItem({ role: "copy" }));
    menu.append(new MenuItem({ role: "paste" }));
    menu.append(new MenuItem({ type: "separator" }));
    menu.append(new MenuItem({ role: "selectAll" }));
    const win = BrowserWindow.fromWebContents(wc);
    if (win) {
      menu.popup({ window: win });
    }
  });
}

app.on("web-contents-created", (_e, wc) => {
  attachSpellcheckContextMenu(wc);
});

app.whenReady().then(async () => {
  log(
    "app ready, isPackaged=%s, resourcesPath=%s",
    app.isPackaged,
    process.resourcesPath,
  );

  // One host per ARGUS_HOME: the Mac app or a CLI host may already be on it.
  if (!(await claimHostLock())) {
    app.exit(0);

    return;
  }

  // Supply the core with the capabilities it can't reach as plain Node. The
  // headless server app has no window, so its UI-shaped capabilities no-op.
  installHostPlatform({ headless: isServerMode() });

  // Renderers are the first sink on the host bus, so they keep receiving
  // events in the order they were emitted even once the gateway taps it too.
  installRendererEventSink();

  installCrashHooks();

  if (isServerMode()) {
    // Accessory app: no Dock tile, no window, just the tray. Also keeps the
    // mini awake for as long as the server runs.
    app.dock?.hide();
    startPowerAssertion();
  } else if (isDev && process.platform === "darwin" && app.dock) {
    // Packaged builds keep the bundle icon: a runtime icon would pin the light
    // variant over AppIcon.icon's dark and tinted appearances.
    const iconPath = resolveAppIconPath();
    if (iconPath) {
      const image = nativeImage.createFromPath(iconPath);
      if (!image.isEmpty()) {
        app.dock.setIcon(image);
      }
    }
  }

  // Everything the core runs — state restore, automations, MCP, the gateway,
  // the MJPEG server and every host command. On the server the gateway is the
  // only way in, so it is forced on rather than a setting.
  startHost({
    forceRemote: isServerMode(),
    webClientDir: resolveWebClientDir(),
  })
    .remoteReady.then(() => startDevTrust())
    .catch((e) => log("Failed to start dev trust: %s", String(e)));
  reportHostLockHandover();

  // Sync system dark/light theme to all active Conductor-managed browsers.
  nativeTheme.on("updated", () => {
    const scheme = nativeTheme.shouldUseDarkColors ? "dark" : "light";
    for (const reservation of appState.webBrowserReservations.values()) {
      setColorScheme(reservation, scheme).catch((e) =>
        log("setColorScheme failed: %s", String(e)),
      );
    }
  });

  // Serve local files via argus-file:// protocol.
  // Used by the renderer to load full-resolution images from disk (e.g. tool
  // result screenshots) instead of relying on base64 blobs.
  // URL format: argus-file:///absolute/path/to/file
  //
  // The protocol is registered with `bypassCSP: true` and `corsEnabled: true`,
  // so any same-origin script in the renderer can `fetch()` it. Without
  // path-containment, this would be an arbitrary-file-read primitive
  // (e.g. `fetch('argus-file:///Users/me/.ssh/id_rsa')`). We restrict it to
  // canonical paths under a registered session and resolve symlinks before
  // comparing, so symlinked escapes inside `node_modules` etc. are rejected.
  protocol.handle("argus-file", async (request) => {
    const url = new URL(request.url);
    const filePath = decodeURIComponent(url.pathname);
    let canonical: string;
    try {
      canonical = await fs.promises.realpath(filePath);
    } catch {
      return new Response("Not found", { status: 404 });
    }

    let allowed = false;
    for (const ws of appState.sessions.values()) {
      let canonicalRoot: string;
      try {
        canonicalRoot = await fs.promises.realpath(ws.path);
      } catch {
        continue;
      }
      if (
        canonical === canonicalRoot ||
        canonical.startsWith(canonicalRoot + path.sep)
      ) {
        allowed = true;
        break;
      }
    }
    if (!allowed) {
      return new Response("Forbidden", { status: 403 });
    }

    return net.fetch(pathToFileURL(canonical).href);
  });

  // Set Content-Security-Policy and inject CORP headers for external images.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };

    // Cross-origin resources need CORP: cross-origin to satisfy COEP require-corp.
    // Gravatar images and the local simulator MJPEG stream (served by the bridge
    // binary on 127.0.0.1) both need this header injected.
    if (
      details.url.startsWith("https://www.gravatar.com/") ||
      details.url.startsWith("http://127.0.0.1:")
    ) {
      headers["Cross-Origin-Resource-Policy"] = ["cross-origin"];
    }

    // Apply CSP to top-level document responses only.
    if (details.resourceType === "mainFrame") {
      const csp = [
        "default-src 'self'",
        "script-src 'self' https://*.i.posthog.com" +
          (isDev
            ? " 'unsafe-inline' 'unsafe-eval'"
            : " 'sha256-PSPsfpU4uc1//0GK5lM0KrdHS2UBpy5pXU7hQYefIyI='"),
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self' data:",
        "img-src 'self' argus-file: data: blob: https: http://127.0.0.1:*",
        // ws:/wss: are open because remote mode dials an arbitrary paired host
        // (LAN, Tailscale or tunnel). The gateway's Noise static-key pinning,
        // not CSP, is what authenticates that connection.
        "connect-src 'self' data: ws: wss: https://*.i.posthog.com" +
          (isDev ? " http://localhost:*" : ""),
        "worker-src 'self' blob: data:",
      ].join("; ");
      headers["Content-Security-Policy"] = [csp];
    }

    callback({ responseHeaders: headers });
  });

  // Register all IPC handlers before creating the window.
  // Publish every registry command on ipcMain as it is defined.
  installIpcCommandBridge();
  registerShellCommands({
    createFloatingDeviceWindow,
    closeFloatingDeviceWindow,
    createFloatingAgentWindow,
    closeFloatingAgentWindow,
    markQuitConfirmedDespiteAgents,
  });

  if (!isServerMode()) {
    Menu.setApplicationMenu(buildAppMenu());
    createWindow();
  }

  // Menu-bar tray with a live "running agents" dropdown. macOS-only — the
  // helper no-ops on other platforms.
  initTray({
    describeHost: isServerMode()
      ? () => [
          `Argus Server ${app.getVersion()}`,
          `Gateway: ws://127.0.0.1:${LOCAL_GATEWAY_PORT}`,
          `State: ${argusHomeDir()}`,
        ]
      : undefined,
    navigateMainWindow,
  });

  // Handoff from the phone — same destination as a tray click, so it goes
  // through the same navigator.
  initContinuity(navigateMainWindow);

  // Auto-updater. Skips itself in dev; in packaged builds it kicks off an
  // initial feed check after a short delay and re-checks hourly.
  setBeforeQuitAndInstallHook(() => {
    isQuitting = true;
    bypassRunningAgentsGuard = true;
  });
  initUpdater();
  // The server has no window to show an update banner in, so its tray owns the
  // flow instead. No-ops on the desktop.
  initServerUpdates();

  // Refresh branch names when the window regains focus — fallback for cases
  // where fs.watch on .git/HEAD misses events (network drives, sleep/wake).
  app.on("browser-window-focus", () => {
    refreshAllBranches();
  });
});

/** Re-exported for back-compat; services import from `./mainWindow` directly. */
export { getMainWindow } from "./mainWindow";

/** Runtime targets that can be detached into their own window (Web can't). */
type PopoutPlatform = "android" | "ios" | "video";

interface PopoutSize {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}

/**
 * Pick a popout window size matching the target's native aspect. A live
 * capture reports its real framebuffer size; otherwise we infer from the
 * runtime / name: tvOS is 16:9 landscape, iPads are ~4:3 portrait, phones are
 * tall portrait rectangles (~9:19.5), and video inputs are 16:9.
 */
function popoutDimensionsForDevice(target: {
  platform: PopoutPlatform;
  deviceKey: string;
  deviceName: string;
  runtime: string;
}): PopoutSize {
  // The popout has ~28px of title-bar chrome above the stream and a ~60px
  // floating action bar below it. Add that vertical slack on top of the
  // framebuffer aspect so the stream itself still fits the native ratio after
  // the chrome is subtracted.
  const CHROME_V = 100;
  const { platform, deviceKey, deviceName, runtime } = target;

  const sized = (width: number, aspect: number): PopoutSize => ({
    width,
    height: Math.round(width * aspect) + CHROME_V,
    minWidth: Math.round(width * 0.65),
    minHeight: Math.round(width * 0.65 * aspect) + CHROME_V,
  });

  if (runtime.startsWith("tvOS")) {
    // 16:9 landscape, plus ~150px width for the Apple TV remote column — the
    // stream's own aspect would leave no room for it.
    return {
      width: 820,
      height: 420 + CHROME_V,
      minWidth: 520,
      minHeight: 380,
    };
  }

  const dims = getVideoDims(deviceKey);
  if (dims && dims.width > 0) {
    const aspect = dims.height / dims.width;

    return sized(aspect >= 1 ? 340 : 820, aspect);
  }

  if (platform === "video") {
    return sized(820, 9 / 16);
  }
  if (/ipad/i.test(deviceName) || runtime.startsWith("iPadOS")) {
    return sized(520, 4 / 3);
  }

  return sized(320, 19.5 / 9);
}

/** Popout registry key — UDIDs and Android serials share one map. */
function popoutKey(platform: PopoutPlatform, deviceKey: string): string {
  return `${platform}:${deviceKey}`;
}

/**
 * Open a floating, always-on-top popout window for a runtime target — an iOS /
 * Android simulator or a video input (capture card). The popout renders its
 * own React tree (see `app/main.tsx` — the query string `?popout=device&...`
 * short-circuits the full app shell) and subscribes to the same broadcast
 * frame stream as the main window, so both share one capture session.
 *
 * Idempotent: reusing the same target focuses the existing popout.
 */
export function createFloatingDeviceWindow(options: {
  platform: PopoutPlatform;
  deviceKey: string;
  deviceName: string;
  runtime: string;
  online: boolean;
  capturing: boolean;
}): BrowserWindow {
  const { platform, deviceKey, deviceName, runtime, online, capturing } =
    options;
  const key = popoutKey(platform, deviceKey);
  const existing = devicePopouts.get(key);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();

    return existing;
  }

  const { width, height, minWidth, minHeight } = popoutDimensionsForDevice({
    platform,
    deviceKey,
    deviceName,
    runtime,
  });

  const win = new BrowserWindow({
    width,
    height,
    minWidth,
    minHeight,
    show: false,
    alwaysOnTop: true,
    backgroundColor: "#000000",
    title: `Argus · ${deviceName}`,
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 8, y: 8 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const params = new URLSearchParams({
    popout: "device",
    platform,
    deviceKey,
    name: deviceName,
    runtime,
    online: online ? "1" : "0",
    capturing: capturing ? "1" : "0",
  });

  if (isDev) {
    win.loadURL(`${VITE_DEV_URL}?${params.toString()}`);
  } else {
    const indexPath = path.join(__dirname, "../dist/index.html");
    win.loadFile(indexPath, { search: `?${params.toString()}` });
  }

  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    log("device popout did-fail-load: code=%d desc=%s url=%s", code, desc, url);
  });

  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    devicePopouts.delete(key);
    // Release the capture reference acquired at open_device_popout. If the main
    // window still holds one for this device the bridge keeps running; other
    // devices are unaffected. Video inputs stream straight from the renderer,
    // so there is nothing to release.
    if (platform === "ios") {
      stopSimulatorCapture(deviceKey);
    } else if (platform === "android") {
      stopAndroidCapture(deviceKey);
    }
  });

  devicePopouts.set(key, win);

  return win;
}

/** Close the popout window for a given target, if any. */
export function closeFloatingDeviceWindow(
  platform: PopoutPlatform,
  deviceKey: string,
): void {
  const key = popoutKey(platform, deviceKey);
  const win = devicePopouts.get(key);
  if (win && !win.isDestroyed()) {
    win.close();
  }
  devicePopouts.delete(key);
}

/**
 * Open an agent in its own floating window. The new window loads the same
 * renderer bundle with `?popout=agent&agentId=...&sessionId=...`, which
 * short-circuits into the minimal `AgentPopout` React tree (see
 * `app/main.tsx`). The main window hides the agent's tab while the popout is
 * open; closing the window (or pressing the "back to main window" button)
 * returns it to the tab bar.
 *
 * Idempotent: reusing the same agentId focuses the existing popout.
 */
export function createFloatingAgentWindow(options: {
  agentId: string;
  sessionId: string;
  title?: string;
  /** Drop cursor position (screen coords). When set, the window is placed so
   * the cursor sits inside its top edge, making the drag release feel like
   * the ghost is landing on the new window. */
  cursorX?: number;
  cursorY?: number;
}): BrowserWindow {
  const { agentId, sessionId, title, cursorX, cursorY } = options;
  const existing = agentPopouts.get(agentId);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();

    return existing;
  }

  const width = 520;
  const height = 720;
  const placement =
    typeof cursorX === "number" && typeof cursorY === "number"
      ? { x: Math.round(cursorX - width / 2), y: Math.round(cursorY - 20) }
      : {};

  const win = new BrowserWindow({
    width,
    height,
    minWidth: 360,
    minHeight: 400,
    ...placement,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#15151c" : "#fafbfc",
    title: title ? `Argus · ${title}` : "Argus · Agent",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const params = new URLSearchParams({
    popout: "agent",
    agentId,
    sessionId,
    ...(title ? { title } : {}),
  });

  if (isDev) {
    win.loadURL(`${VITE_DEV_URL}?${params.toString()}`);
  } else {
    const indexPath = path.join(__dirname, "../dist/index.html");
    win.loadFile(indexPath, { search: `?${params.toString()}` });
  }

  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    agentPopouts.delete(agentId);
    emitHostEvent("agent:popout-closed", { agentId });
  });

  agentPopouts.set(agentId, win);

  return win;
}

/** Close the popout window for a given agentId, if any. */
export function closeFloatingAgentWindow(agentId: string): void {
  const win = agentPopouts.get(agentId);
  if (win && !win.isDestroyed()) {
    win.close();
  }
  agentPopouts.delete(agentId);
}
