/**
 * Spawns and manages the `argus-hotkey-bridge` Swift helper.
 *
 * The helper writes one JSON object per line to stdout. We forward `trigger`
 * events to a callback (which calls `toggleLauncher`), and surface the
 * one-shot Accessibility permission status so the renderer can nudge the
 * user toward System Settings.
 */

import { app } from "electron";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createLogger } from "../../../app/lib/logger";

const log = createLogger("hotkeyBridge");

interface BridgeMessage {
  event: "exit" | "permission_denied" | "ready" | "trigger";
  accessibility_granted?: boolean;
  reason?: string;
}

interface BridgeHandle {
  stop: () => void;
  /** Latest known Accessibility permission status, or null if not yet reported. */
  getStatus: () => HotkeyBridgeStatus;
}

export interface HotkeyBridgeStatus {
  running: boolean;
  accessibilityGranted: boolean | null;
  /** Last error reason if the bridge failed to spawn or crashed. */
  lastError: string | null;
}

let activeStatus: HotkeyBridgeStatus = {
  running: false,
  accessibilityGranted: null,
  lastError: null,
};

/** Resolve the path to the bundled `argus-hotkey-bridge` binary. */
function resolveBinaryPath(): string | null {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, "argus-hotkey-bridge"),
        path.join(app.getAppPath(), "..", "argus-hotkey-bridge"),
      ]
    : [
        // Bundled output: dist-electron/main.js → ../native/...
        path.join(
          __dirname,
          "..",
          "native",
          "argus-hotkey-bridge",
          "argus-hotkey-bridge",
        ),
        // Unbundled: electron/services/launcher/ → ../../../native/...
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "native",
          "argus-hotkey-bridge",
          "argus-hotkey-bridge",
        ),
      ];
  for (const c of candidates) {
    if (existsSync(c)) {
      return c;
    }
  }

  return null;
}

/**
 * Spawn the bridge. `onTrigger` is invoked every time the user double-taps
 * right Option. The returned handle exposes a stop function and the most
 * recent permission/running status.
 */
export function startHotkeyBridge(onTrigger: () => void): BridgeHandle | null {
  if (process.platform !== "darwin") {
    return null;
  }

  const binary = resolveBinaryPath();
  if (!binary) {
    activeStatus = {
      running: false,
      accessibilityGranted: null,
      lastError: "binary_missing",
    };
    log.warn(
      "argus-hotkey-bridge binary not found; double-tap right Option will not work",
    );

    return null;
  }

  let child: ChildProcessWithoutNullStreams | null;
  try {
    child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
  } catch (e) {
    activeStatus = {
      running: false,
      accessibilityGranted: null,
      lastError: e instanceof Error ? e.message : String(e),
    };
    log.error("failed to spawn hotkey bridge:", e);

    return null;
  }

  activeStatus = { running: true, accessibilityGranted: null, lastError: null };

  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let newlineIdx = buffer.indexOf("\n");
    while (newlineIdx !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      newlineIdx = buffer.indexOf("\n");
      if (!line) {
        continue;
      }
      try {
        const msg = JSON.parse(line) as BridgeMessage;
        handleMessage(msg, onTrigger);
      } catch {
        log.warn("non-JSON line from bridge: %s", line);
      }
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    log.warn("bridge stderr: %s", chunk.trim());
  });

  child.on("exit", (code, signal) => {
    activeStatus = {
      ...activeStatus,
      running: false,
      lastError:
        code !== 0 || signal
          ? `exit code=${code} signal=${signal}`
          : activeStatus.lastError,
    };
    log.info("bridge exited code=%s signal=%s", code, signal);
  });

  return {
    getStatus: () => activeStatus,
    stop: () => {
      if (child && !child.killed) {
        try {
          child.stdin.end();
        } catch {
          // ignore
        }
        child.kill();
      }
    },
  };
}

function handleMessage(msg: BridgeMessage, onTrigger: () => void): void {
  switch (msg.event) {
    case "ready":
      activeStatus = {
        ...activeStatus,
        accessibilityGranted: msg.accessibility_granted ?? false,
      };
      break;
    case "permission_denied":
      activeStatus = { ...activeStatus, accessibilityGranted: false };
      break;
    case "trigger":
      onTrigger();
      break;
    case "exit":
      activeStatus = {
        ...activeStatus,
        running: false,
        lastError: msg.reason ?? null,
      };
      break;
    default:
      break;
  }
}

/** Latest cached status — for the Settings dialog. */
export function getHotkeyBridgeStatus(): HotkeyBridgeStatus {
  return activeStatus;
}
