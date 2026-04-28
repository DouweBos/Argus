/**
 * Main-process telemetry. Sends anonymous feature-usage and crash/error events
 * to PostHog. Privacy rules:
 *
 * - Distinct id is a random UUID stored under `~/.argus/telemetry-id`.
 *   Never linked to any user account or system identifier.
 * - No autocapture, no session recording, no IP, no PII in props.
 * - Off when `enabled` is false (renderer mirrors via the
 *   `telemetry_set_enabled` IPC).
 * - Off when `POSTHOG_KEY` / `VITE_POSTHOG_KEY` are not configured.
 */
import type {
  EventArgs,
  EventMap,
  EventName,
} from "../../../app/lib/telemetryEvents";
import { app } from "electron";
import os from "node:os";
import { PostHog } from "posthog-node";
import { createLogger, setErrorSink } from "../../../app/lib/logger";
import { getAnonymousId } from "./anonymousId";

const log = createLogger("telemetry");

const API_KEY = process.env.POSTHOG_KEY ?? process.env.VITE_POSTHOG_KEY ?? "";
const HOST =
  process.env.POSTHOG_HOST ??
  process.env.VITE_POSTHOG_HOST ??
  "https://eu.i.posthog.com";

let client: PostHog | null = null;
// Default opt-out — the renderer pushes the user's consent state via
// `telemetry_set_enabled` once it boots. Until then, no events are sent.
let enabled = false;
let distinctId = "";

function baseProps(): Record<string, boolean | number | string> {
  return {
    app_version: app.getVersion(),
    is_packaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    os_release: os.release(),
    electron_version: process.versions.electron ?? "",
    node_version: process.versions.node,
  };
}

export function initTelemetry(): void {
  distinctId = getAnonymousId();

  // eslint-disable-next-line no-constant-condition, no-constant-binary-expression
  if (false && !app.isPackaged) {
    log.info("disabled — dev build");

    return;
  }

  if (!API_KEY) {
    log.info("disabled — no POSTHOG_KEY configured");

    return;
  }

  client = new PostHog(API_KEY, {
    host: HOST,
    // Argus is low-volume — flush every event immediately so we don't lose
    // batches when the user quits before the 10s interval ticks.
    flushAt: 1,
    flushInterval: 0,
    disableGeoip: true,
  });
  log.info(`initialized; host=${HOST}`);

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
      // Intentionally drop `name` — it can be a window title (PII risk).
    });
  });

  process.on("uncaughtException", (err) => {
    captureException(err, { source: "uncaughtException" });
  });
  process.on("unhandledRejection", (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    captureException(err, { source: "unhandledRejection" });
  });

  // Forward `log.error(...)` calls to PostHog as `app_error` so caught errors
  // — which never reach the unhandledException path — still get visibility.
  setErrorSink((scope, args) => {
    capture("app_error", {
      scope: scope ?? "",
      message: scrubMessage(formatLogArgs(args)),
    });
  });
}

export function setTelemetryEnabled(next: boolean): void {
  if (next === enabled) {
    return;
  }
  log.info(`setTelemetryEnabled(${next})`);
  if (!next) {
    // Capture the off-event while still enabled, then flip + flush.
    capture("telemetry_disabled");
    enabled = false;
    client?.flush().catch(() => undefined);

    return;
  }
  enabled = true;
  // First time we go from off → on (incl. post-consent), record a launch
  // event so the install shows up in PostHog.
  capture("app_launched");
  capture("telemetry_enabled");
}

export function isTelemetryEnabled(): boolean {
  return enabled;
}

export function capture<N extends EventName>(
  event: N,
  ...rest: EventArgs<N>
): void {
  if (!client) {
    log.info(`drop ${event}: client not initialized (no POSTHOG_KEY?)`);

    return;
  }
  if (!enabled) {
    log.info(`drop ${event}: telemetry disabled`);

    return;
  }
  const props = (rest[0] ?? {}) as EventMap[N] & Record<string, unknown>;
  try {
    client.capture({
      distinctId,
      event,
      properties: { ...baseProps(), ...props },
    });
    log.info(`capture ${event}`);
  } catch (e) {
    log.warn("capture failed", e);
  }
}

/**
 * Sanitize an error for sending. Strips message segments that look like file
 * paths so we never ship the user's home directory or repo names.
 */
function scrubMessage(msg: string): string {
  return msg
    .replace(/\/Users\/[^/\s'")]+/g, "/Users/<user>")
    .replace(/\/home\/[^/\s'")]+/g, "/home/<user>")
    .replace(/[A-Z]:\\Users\\[^\\\s'")]+/g, "C:\\Users\\<user>");
}

/**
 * Best-effort string for log.error args — keep just enough to triage in
 * PostHog without dragging arbitrary object trees over the wire.
 */
function formatLogArgs(args: unknown[]): string {
  return args
    .slice(0, 4)
    .map((a) => {
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
    })
    .join(" ")
    .slice(0, 2000);
}

export function captureException(
  err: unknown,
  props: Record<string, unknown> = {},
): void {
  if (!enabled || !client) {
    return;
  }
  const error = err instanceof Error ? err : new Error(String(err));
  try {
    client.capture({
      distinctId,
      event: "$exception",
      properties: {
        ...baseProps(),
        ...props,
        $exception_type: error.name,
        $exception_message: scrubMessage(error.message),
        $exception_stack_trace_raw: error.stack
          ? scrubMessage(error.stack)
          : undefined,
        $exception_level: "error",
      },
    });
  } catch (e) {
    log.warn("captureException failed", e);
  }
}

export async function shutdownTelemetry(): Promise<void> {
  if (!client) {
    return;
  }
  try {
    await client.shutdown();
  } catch {
    // best effort
  }
  client = null;
}
