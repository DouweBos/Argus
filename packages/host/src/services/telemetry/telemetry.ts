/**
 * Main-process telemetry. Sends anonymous feature-usage and crash/error events
 * to PostHog. Privacy rules:
 *
 * - Distinct id is a random UUID stored under `~/.argus/telemetry-id`.
 *   Never linked to any user account or system identifier.
 * - No autocapture, no session recording, no IP, no PII in props.
 * - Two modes (`presence` / `full`) — the renderer mirrors the user's choice
 *   via the `telemetry_set_mode` IPC. `presence` is the floor: a single
 *   anonymous heartbeat per launch (no baseProps merge, no errors, no
 *   feedback); `full` enables the whole event catalogue.
 * - Off when `POSTHOG_KEY` is not configured. The key is inlined into the
 *   main bundle at build time by `build-electron.mjs` via esbuild `define`
 *   (matching how Vite inlines `VITE_POSTHOG_KEY` for the renderer); reading
 *   `process.env` at runtime in a packaged Electron app would always be
 *   empty, which is exactly the bug this avoids.
 */
import type {
  EventArgs,
  EventMap,
  EventName,
} from "@argus/host/telemetryEvents";
import os from "node:os";
import { PostHog } from "posthog-node";
import { createLogger, setErrorSink } from "@argus/host/logger";
import { hostPlatform } from "@argus/host/platform";
import { getAnonymousId } from "./anonymousId";

const log = createLogger("telemetry");

const API_KEY = process.env.POSTHOG_KEY ?? "";
const HOST = process.env.POSTHOG_HOST || "https://eu.i.posthog.com";

export type TelemetryMode = "full" | "presence";

let client: PostHog | null = null;
// Presence is the floor — the renderer pushes the user's choice via
// `telemetry_set_mode` once it boots, and can only ever raise it to `full`.
let mode: TelemetryMode = "presence";
let distinctId = "";

function baseProps(): Record<string, boolean | number | string> {
  return {
    app_version: hostPlatform().appVersion(),
    is_packaged: hostPlatform().isPackaged(),
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
  if (false && !hostPlatform().isPackaged()) {
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

  // Once per process: PostHog defines DAU as "users with a `$pageview`", so
  // this is what makes presence-only installs countable at all.
  captureHeartbeat();

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

export function setTelemetryMode(next: TelemetryMode): void {
  if (next === mode) {
    return;
  }
  log.info(`setTelemetryMode(${mode} -> ${next})`);

  if (next === "full") {
    mode = "full";
    capture("app_launched");
    capture("telemetry_enabled");

    return;
  }

  // full → presence: record the downgrade before the gate closes.
  capture("telemetry_disabled");
  mode = "presence";
  client?.flush().catch(() => undefined);
}

export function getTelemetryMode(): TelemetryMode {
  return mode;
}

export function isTelemetryEnabled(): boolean {
  return mode === "full";
}

/**
 * Whether the build has a PostHog key inlined (and therefore the main
 * process is capable of delivering events at all). Renderer asks for this
 * at boot so `getFeedbackUnavailableReason()` can tell the user up front
 * that messages can't be delivered.
 */
export function isTelemetryConfigured(): boolean {
  return Boolean(client);
}

export function capture<N extends EventName>(
  event: N,
  ...rest: EventArgs<N>
): void {
  if (!client) {
    log.info(`drop ${event}: client not initialized (no POSTHOG_KEY?)`);

    return;
  }
  if (mode === "presence") {
    // Presence-only mode: nothing escapes except the once-per-launch
    // heartbeat, which goes through `captureHeartbeat()` directly (it's a
    // `$pageview`, not a typed catalog event).
    log.info(`drop ${event}: presence mode`);

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
 * Send the once-per-launch DAU heartbeat. PostHog defines DAU as the count
 * of users with a `$pageview` event, so the heartbeat has to be a
 * `$pageview` (not a custom event) to make presence-only users countable.
 *
 * Bypasses `baseProps()` so we don't leak OS / arch / electron version for
 * presence-only users — the only property attached is `app_version`,
 * which is the minimum useful signal for "are old builds still in the
 * wild?". The path is a fixed `argus:///` literal that contains no
 * project / session / org / PR identifiers.
 */
function captureHeartbeat(): void {
  if (!client) {
    return;
  }
  try {
    client.capture({
      distinctId,
      event: "$pageview",
      properties: {
        $current_url: "argus:///",
        $pathname: "/",
        app_version: hostPlatform().appVersion(),
        source: "heartbeat",
      },
    });
    log.info("capture $pageview (heartbeat)");
  } catch (e) {
    log.warn("captureHeartbeat failed", e);
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
  // Errors only flow in full mode — presence-only users explicitly chose to
  // not share usage details, and stack traces can leak file paths even after
  // scrubbing.
  if (mode !== "full" || !client) {
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

/**
 * Send a free-form `user_feedback` event with PostHog's `$set_once` magic
 * so the person profile is flagged as having submitted feedback at least
 * once. Bypasses the typed event catalog because the prop shape is bespoke.
 */
export function captureFeedback(message: string): void {
  if (!client) {
    log.info("drop user_feedback: client not initialized");

    return;
  }
  if (mode !== "full") {
    log.info("drop user_feedback: telemetry not in full mode");

    return;
  }
  try {
    client.capture({
      distinctId,
      event: "user_feedback",
      properties: {
        ...baseProps(),
        $set_once: { has_submitted_feedback: true },
        message,
      },
    });
    log.info("capture user_feedback");
  } catch (e) {
    log.warn("captureFeedback failed", e);
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
