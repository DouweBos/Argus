/**
 * Electron-only crash hooks.
 *
 * `render-process-gone` and `child-process-gone` are emitted by the Electron
 * `app` object, which the telemetry service (now part of `@argus/host`) can no
 * longer see. Registered from `main.ts` right after telemetry initialises.
 */

import { app } from "electron";
import { captureException } from "./services/telemetry/telemetry";

export function installCrashHooks(): void {
  // Capture crashes from any render process (renderer windows, popouts).
  app.on("render-process-gone", (_event, _wc, details) => {
    captureException(new Error(`render-process-gone: ${details.reason}`), {
      reason: details.reason,
      exitCode: details.exitCode,
      source: "render-process-gone",
    });
  });

  app.on("child-process-gone", (_event, details) => {
    captureException(new Error(`child-process-gone: ${details.type}`), {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      source: "child-process-gone",
    });
  });
}
