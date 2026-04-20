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
  nativeTheme,
  net,
  protocol,
  session,
  shell,
} from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { log as emitLog } from "../app/lib/logger";
import { registerIpcHandlers } from "./ipc";
import { writeLogLine } from "./lib/logFile";
import { stopAllScreencasts } from "./services/browser/cdpScreencast";
import { setColorScheme } from "./services/browser/conductorInput";
import {
  startMjpegServer,
  stopMjpegServer,
} from "./services/browser/mjpegServer";
import { webBrowserPool } from "./services/browser/pool";
import { startMcpServer, stopMcpServer } from "./services/mcp/server";
import { initOrganizations } from "./services/organization/manager";
import { initOrgTasks } from "./services/organizationTask/manager";
import { fixProcessPath } from "./services/terminal/shellEnv";
import { refreshAllBranches } from "./services/workspace/watcher";
import { appState } from "./state";

// Remote debugging port is no longer needed — Conductor now owns the browser
// and Argus connects via CDP to Conductor's Chromium instance.

// Register custom protocols as privileged before app is ready.
// This lets the renderer fetch extension files and workspace images via URL.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "argus-ext",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true,
    },
  },
  {
    scheme: "extension-file",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true,
    },
  },
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

let mainWindow: BrowserWindow | null = null;
let pendingDeepLink: string | null = null;

const isDev = !app.isPackaged;

// `argus://workspaces/<id>/git` — register as this app's protocol handler so
// external callers (MCP, Slack previews, custom URL openers) can jump straight
// into a screen. Uses setAsDefaultProtocolClient; the actual URL is received
// via `open-url` (macOS) or the `second-instance` argv on Linux/Windows.
if (!app.isDefaultProtocolClient("argus")) {
  app.setAsDefaultProtocolClient("argus");
}

/** Turn an `argus://...` URL into an in-app pathname. */
function deepLinkToPath(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "argus:") {
      return null;
    }
    // argus://workspaces/abc/git → /workspaces/abc/git
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
const VITE_DEV_URL = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:1420";

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

function createWindow(): void {
  log("createWindow: isDev=%s, __dirname=%s", isDev, __dirname);
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: "#1e1e1e",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

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
  });

  mainWindow.webContents.on("did-finish-load", () => {
    log("did-finish-load: %s", mainWindow?.webContents.getURL());
    if (pendingDeepLink && mainWindow) {
      mainWindow.webContents.send("navigation:goto", {
        path: pendingDeepLink,
      });
      pendingDeepLink = null;
    }
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

  // Spellcheck context menu — Electron enables the spellchecker by default but
  // doesn't surface suggestions. Build a minimal context menu on right-click in
  // editable fields with suggestions, Add to Dictionary, and the standard edit
  // commands so misspellings can actually be corrected.
  mainWindow.webContents.on("context-menu", (_e, params) => {
    if (!params.isEditable) {
      return;
    }
    const menu = new Menu();
    if (params.misspelledWord) {
      const wc = mainWindow.webContents;
      for (const suggestion of params.dictionarySuggestions) {
        menu.append(
          new MenuItem({
            label: suggestion,
            click: () => wc.replaceMisspelling(suggestion),
          }),
        );
      }
      if (params.dictionarySuggestions.length === 0) {
        menu.append(
          new MenuItem({
            label: "No suggestions",
            enabled: false,
          }),
        );
      }
      menu.append(new MenuItem({ type: "separator" }));
      menu.append(
        new MenuItem({
          label: "Add to Dictionary",
          click: () =>
            mainWindow?.webContents.session.addWordToSpellCheckerDictionary(
              params.misspelledWord,
            ),
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
    if (mainWindow) {
      menu.popup({ window: mainWindow });
    }
  });

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
  if (process.platform !== "darwin") {
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

/** Called by ipc.ts once the renderer has confirmed quit-with-running-agents. */
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

  if (runningAgentIds.length > 0 && !bypassRunningAgentsGuard) {
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
  stopMcpServer();
  stopMjpegServer();
  stopAllScreencasts();
  webBrowserPool.releaseAll().catch((err) => {
    log("webBrowserPool.releaseAll failed: %s", err);
  });
  // Give the renderer a moment to save active conversations before destroying
  // the window. The renderer listens for `app:will-quit` and persists chat
  // history synchronously via IPC.
  if (mainWindow && !mainWindow.isDestroyed()) {
    e.preventDefault();
    mainWindow.webContents.send("app:will-quit");
    setTimeout(() => {
      // The @codingame/monaco-vscode-api registers a beforeunload handler via
      // addEventListener that cancels the first close. Destroy the window
      // directly to bypass it — we handle our own save state, not VS Code's.
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.destroy();
      }
      app.quit();
    }, 300);
  }
});

// macOS: re-show window when dock icon is clicked.
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    mainWindow?.show();
    mainWindow?.focus();
  }
});

app.whenReady().then(() => {
  log(
    "app ready, isPackaged=%s, resourcesPath=%s",
    app.isPackaged,
    process.resourcesPath,
  );

  // Fix PATH for bundled .app builds — ensures PATH includes Homebrew, mise, etc.
  const pathDiag = fixProcessPath();
  pathDiag.forEach((d) => log("[shellEnv] %s", d));

  // Start the Argus MCP server so agents can orchestrate workspaces and
  // sibling agents via the Model Context Protocol.
  startMcpServer().catch((e) =>
    log("Failed to start MCP server: %s", String(e)),
  );

  // Start the MJPEG server for streaming browser frames via CDP screencast.
  startMjpegServer().catch((e) =>
    log("Failed to start MJPEG server: %s", String(e)),
  );

  // Load persisted organizations and register their member repos.
  try {
    initOrganizations();
  } catch (e) {
    log("initOrganizations failed: %s", String(e));
  }

  try {
    initOrgTasks();
  } catch (e) {
    log("initOrgTasks failed: %s", String(e));
  }

  // Sync system dark/light theme to all active Conductor-managed browsers.
  nativeTheme.on("updated", () => {
    const scheme = nativeTheme.shouldUseDarkColors ? "dark" : "light";
    for (const reservation of appState.webBrowserReservations.values()) {
      setColorScheme(reservation, scheme).catch((e) =>
        log("setColorScheme failed: %s", String(e)),
      );
    }
  });

  // Allowed root directories for extension file serving.
  const extensionRoots = [
    path.join(os.homedir(), ".vscode", "extensions"),
    path.join(os.homedir(), ".cursor", "extensions"),
    path.join(os.homedir(), ".argus", "extensions"),
  ];

  /** Validate that a file path falls within an allowed extension directory. */
  function isAllowedExtensionPath(filePath: string): boolean {
    const resolved = path.resolve(filePath);

    return extensionRoots.some(
      (root) => resolved.startsWith(root + path.sep) || resolved === root,
    );
  }

  // Serve extension files via argus-ext:// protocol.
  // URL format: argus-ext://ext/<absolute-path-to-file>
  protocol.handle("argus-ext", (request) => {
    const url = new URL(request.url);
    const filePath = decodeURIComponent(url.pathname);
    if (!isAllowedExtensionPath(filePath)) {
      return new Response("Forbidden", { status: 403 });
    }

    return net.fetch(`file://${filePath}`);
  });

  // Serve extension-file:// URIs (used by VS Code extension icon references).
  // URL format: extension-file://<publisher.name>/<absolute-path-to-file>
  protocol.handle("extension-file", (request) => {
    const url = new URL(request.url);
    const filePath = decodeURIComponent(url.pathname);
    if (!isAllowedExtensionPath(filePath)) {
      return new Response("Forbidden", { status: 403 });
    }

    return net.fetch(`file://${filePath}`);
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
  // canonical paths under a registered workspace and resolve symlinks before
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
    for (const ws of appState.workspaces.values()) {
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
        "default-src 'self' argus-ext:",
        "script-src 'self' argus-ext:" +
          (isDev ? " 'unsafe-inline' 'unsafe-eval'" : ""),
        "style-src 'self' 'unsafe-inline' argus-ext:",
        "font-src 'self' argus-ext: data:",
        "img-src 'self' argus-ext: argus-file: extension-file: data: blob: https: http://127.0.0.1:*",
        "connect-src 'self' argus-ext: data: https://open-vsx.org" +
          (isDev ? " ws://localhost:* http://localhost:*" : ""),
        "worker-src 'self' blob: data: argus-ext:",
      ].join("; ");
      headers["Content-Security-Policy"] = [csp];
    }

    callback({ responseHeaders: headers });
  });

  // Register all IPC handlers before creating the window.
  registerIpcHandlers();

  createWindow();

  // Refresh branch names when the window regains focus — fallback for cases
  // where fs.watch on .git/HEAD misses events (network drives, sleep/wake).
  app.on("browser-window-focus", () => {
    refreshAllBranches();
  });
});

/** Return the main BrowserWindow (used by services to send events). */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

/**
 * Open a floating, always-on-top simulator popout window mirroring the
 * capture stream for the given `udid`. The popout renders its own React tree
 * (see `app/main.tsx` — the query string `?popout=simulator&...` short-
 * circuits the full app shell) and subscribes to the same MJPEG port served
 * by the bridge binary, so both main and popout windows share one capture
 * session.
 *
 * Idempotent: reusing the same udid focuses the existing popout.
 */
export function createFloatingSimulatorWindow(options: {
  udid: string;
  mjpegPort: number | null;
  deviceName: string;
}): BrowserWindow {
  const { udid, mjpegPort, deviceName } = options;
  const existing = appState.simulatorPopouts.get(udid);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();

    return existing;
  }

  const win = new BrowserWindow({
    width: 320,
    height: 680,
    minWidth: 220,
    minHeight: 420,
    show: false,
    alwaysOnTop: true,
    backgroundColor: "#000000",
    title: `Argus · ${deviceName}`,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const params = new URLSearchParams({
    popout: "simulator",
    udid,
    name: deviceName,
    ...(mjpegPort != null ? { port: String(mjpegPort) } : {}),
  });

  if (isDev) {
    win.loadURL(`${VITE_DEV_URL}?${params.toString()}`);
  } else {
    const indexPath = path.join(__dirname, "../dist/index.html");
    win.loadFile(indexPath, { search: `?${params.toString()}` });
  }

  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    appState.simulatorPopouts.delete(udid);
  });

  appState.simulatorPopouts.set(udid, win);

  return win;
}

/** Close the popout window for a given udid, if any. */
export function closeFloatingSimulatorWindow(udid: string): void {
  const win = appState.simulatorPopouts.get(udid);
  if (win && !win.isDestroyed()) {
    win.close();
  }
  appState.simulatorPopouts.delete(udid);
}
