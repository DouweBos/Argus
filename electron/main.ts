/**
 * Electron main process entry point.
 *
 * Creates the BrowserWindow, loads the Vite dev server (dev) or bundled
 * index.html (prod), and wires up IPC handlers.
 */

import { app, BrowserWindow, net, protocol, session, shell } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerIpcHandlers } from "./ipc";
import { fixProcessPath } from "./services/terminal/shellEnv";

// Register the stagehand-ext:// protocol as privileged before app is ready.
// This lets the renderer fetch extension files via URL.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "stagehand-ext",
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
]);

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (process.platform === "win32") {
  app.setAppUserModelId(app.getName());
}

let mainWindow: BrowserWindow | null = null;

const isDev = !app.isPackaged;
const VITE_DEV_URL = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:1420";

const logPath = path.join(os.homedir(), ".stagehand", "main.log");
fs.mkdirSync(path.dirname(logPath), { recursive: true });
const logStream = fs.createWriteStream(logPath, { flags: "a" });

function log(msg: string, ...args: unknown[]): void {
  const line = `[${new Date().toISOString()}] ${msg} ${args.map((a) => String(a)).join(" ")}\n`;
  logStream.write(line);
  console.log(`[Stagehand] ${msg}`, ...args);
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
app.on("before-quit", () => {
  log("before-quit fired, setting isQuitting=true");
  isQuitting = true;
  // The @codingame/monaco-vscode-api registers a beforeunload handler via
  // addEventListener that cancels the first close. Destroy the window directly
  // to bypass it — we handle our own save state, not VS Code's.
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
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
  fixProcessPath();

  // Allowed root directories for extension file serving.
  const extensionRoots = [
    path.join(os.homedir(), ".vscode", "extensions"),
    path.join(os.homedir(), ".cursor", "extensions"),
    path.join(os.homedir(), ".stagehand", "extensions"),
  ];

  /** Validate that a file path falls within an allowed extension directory. */
  function isAllowedExtensionPath(filePath: string): boolean {
    const resolved = path.resolve(filePath);
    return extensionRoots.some(
      (root) => resolved.startsWith(root + path.sep) || resolved === root,
    );
  }

  // Serve extension files via stagehand-ext:// protocol.
  // URL format: stagehand-ext://ext/<absolute-path-to-file>
  protocol.handle("stagehand-ext", (request) => {
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
        "default-src 'self' stagehand-ext:",
        "script-src 'self' stagehand-ext:" +
          (isDev ? " 'unsafe-inline' 'unsafe-eval'" : ""),
        "style-src 'self' 'unsafe-inline' stagehand-ext:",
        "font-src 'self' stagehand-ext: data:",
        "img-src 'self' stagehand-ext: extension-file: data: https: http://127.0.0.1:*",
        "connect-src 'self' stagehand-ext: https://open-vsx.org" +
          (isDev ? " ws://localhost:* http://localhost:*" : ""),
        "worker-src 'self' blob: stagehand-ext:",
      ].join("; ");
      headers["Content-Security-Policy"] = [csp];
    }

    callback({ responseHeaders: headers });
  });

  // Register all IPC handlers before creating the window.
  registerIpcHandlers();

  createWindow();
});

/** Return the main BrowserWindow (used by services to send events). */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
