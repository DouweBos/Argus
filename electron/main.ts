/**
 * Electron main process entry point.
 *
 * Creates the BrowserWindow, loads the Vite dev server (dev) or bundled
 * index.html (prod), and wires up IPC handlers.
 */

import {
  app,
  BrowserWindow,
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
import { stopAllScreencasts } from "./services/browser/cdpScreencast";
import { setColorScheme } from "./services/browser/conductorInput";
import {
  startMjpegServer,
  stopMjpegServer,
} from "./services/browser/mjpegServer";
import { installConductor } from "./services/cli/conductorInstaller";
import { startMcpServer, stopMcpServer } from "./services/mcp/server";
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

const isDev = !app.isPackaged;
const VITE_DEV_URL = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:1420";

const logPath = path.join(os.homedir(), ".argus", "main.log");
fs.mkdirSync(path.dirname(logPath), { recursive: true });
const logStream = fs.createWriteStream(logPath, { flags: "a" });

function formatArg(a: unknown): string {
  if (a instanceof Error) {
    return a.stack ?? `${a.name}: ${a.message}`;
  }
  if (typeof a === "string") {
    return a;
  }
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

function writeLogLine(level: string, args: unknown[]): void {
  const line = `[${new Date().toISOString()}] [${level}] ${args.map(formatArg).join(" ")}\n`;
  logStream.write(line);
}

// Tee main-process console.* to the log file. In a bundled .app there is no
// attached terminal, so without this tee every console call across services
// (info/warn/error from app/lib/logger.ts) vanishes silently.
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
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// macOS: Cmd+Q triggers before-quit before closing windows. Track it so
// window-all-closed (which fires after) knows not to keep the app alive.
let isQuitting = false;
app.on("before-quit", (e) => {
  if (isQuitting) {
    return;
  }
  log("before-quit fired, setting isQuitting=true");
  isQuitting = true;
  stopMcpServer();
  stopMjpegServer();
  stopAllScreencasts();
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

  // Install/update the conductor CLI to ~/.argus/bin/conductor.
  installConductor();

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
  protocol.handle("argus-file", (request) => {
    const url = new URL(request.url);
    const filePath = decodeURIComponent(url.pathname);
    if (!fs.existsSync(filePath)) {
      return new Response("Not found", { status: 404 });
    }

    return net.fetch(pathToFileURL(filePath).href);
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
        "worker-src 'self' blob: argus-ext:",
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
