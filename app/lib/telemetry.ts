/**
 * Renderer telemetry. Forwards every event to the main process over IPC,
 * which owns the single posthog-node client. Done this way because:
 *
 * - Production renderers run on a `file://` origin where posthog-js is
 *   fragile (Origin: null on requests, localStorage edge cases).
 * - The PostHog secret only lives in the main bundle (esbuild `define` in
 *   `build-electron.mjs`); shipping it into the renderer too would just
 *   double the surface for no benefit.
 * - One pipe, one consent flag, one set of base props.
 *
 * Privacy posture is unchanged: anonymous distinct id, no autocapture,
 * scrubbed messages, opt-out via Settings.
 */
import type { EventArgs, EventMap, EventName } from "./telemetryEvents";
import {
  setTelemetryEnabledOnMain,
  telemetryCapture,
  telemetryCaptureException,
  telemetryCaptureFeedback,
} from "./ipc";
import { createLogger, setErrorSink } from "./logger";

const log = createLogger("telemetry");

let initialized = false;
let enabled = true;
let configured = false;
let popout = "main";

function active(): boolean {
  return initialized && enabled && configured;
}

/**
 * Initialize the renderer telemetry pipe. Call once at renderer startup.
 * `configured` is reported by the main process based on whether a PostHog
 * key is inlined in the build.
 */
export function initTelemetry(opts: {
  configured: boolean;
  enabled: boolean;
  popout: string;
}): void {
  enabled = opts.enabled;
  configured = opts.configured;
  popout = opts.popout;
  initialized = true;

  if (!configured) {
    log.info("disabled — main reports no PostHog key configured");
  }

  // Renderer-side global error handlers — main process catches its own.
  window.addEventListener("error", (event) => {
    captureException(event.error ?? new Error(event.message), {
      source: "window.onerror",
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const err = reason instanceof Error ? reason : new Error(String(reason));
    captureException(err, { source: "unhandledrejection" });
  });

  // Forward `log.error(...)` to PostHog as `app_error` so caught errors get
  // visibility too — `$exception` only fires on truly unhandled crashes.
  setErrorSink((scope, args) => {
    capture("app_error", {
      scope: scope ?? "",
      message: scrubMessage(formatLogArgs(args)),
    });
  });
}

export function setTelemetryEnabled(next: boolean): void {
  enabled = next;
  // Source of truth lives in main; this just keeps the renderer's local
  // gate in sync with the IPC roundtrip below.
  setTelemetryEnabledOnMain(next).catch(() => undefined);
}

export function capture<N extends EventName>(
  event: N,
  ...rest: EventArgs<N>
): void {
  if (!active()) {
    return;
  }
  const props = (rest[0] ?? {}) as EventMap[N] & Record<string, unknown>;
  telemetryCapture(event, { ...props, process: "renderer", popout }).catch(
    (e: unknown) => log.warn("capture failed", e),
  );
}

/**
 * Send a `$pageview` event so PostHog's DAU / Web Analytics insights count
 * navigations. The path passed in must be a sanitised route template
 * (see `routePattern` in `app/lib/router.tsx`) — never a raw pathname,
 * since real paths embed session / organisation / PR identifiers that we
 * never want in telemetry.
 *
 * Bypasses the typed event catalog because `$pageview` is a PostHog magic
 * event with bespoke prop keys (`$current_url`, `$pathname`).
 */
export function capturePageview(pattern: string): void {
  if (!active()) {
    return;
  }
  telemetryCapture("$pageview", {
    $current_url: `argus://${pattern.replace(/^\//, "")}`,
    $pathname: pattern,
    process: "renderer",
    popout,
  }).catch((e: unknown) => log.warn("pageview failed", e));
}

function scrubMessage(msg: string): string {
  return msg
    .replace(/\/Users\/[^/\s'")]+/g, "/Users/<user>")
    .replace(/\/home\/[^/\s'")]+/g, "/home/<user>")
    .replace(/[A-Z]:\\Users\\[^\\\s'")]+/g, "C:\\Users\\<user>");
}

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

/**
 * Returns a human-readable reason if the feedback channel can't currently
 * deliver, or null when it can. UI can surface this up-front instead of
 * waiting for `captureFeedback` to throw on submit.
 */
export function getFeedbackUnavailableReason(): string | null {
  if (!configured) {
    return "Feedback isn't configured in this build, so messages can't be delivered. Please reach out through another channel.";
  }
  if (!enabled) {
    return "Telemetry is turned off in Settings, so feedback can't be sent. Enable telemetry to send feedback.";
  }
  if (!initialized) {
    return "Feedback isn't ready yet — telemetry hasn't finished initializing. Try again in a moment.";
  }

  return null;
}

/**
 * Capture a free-form feedback message. Throws when telemetry can't
 * deliver so the dialog can surface that state to the user instead of
 * silently dropping their message.
 */
export function captureFeedback(message: string): void {
  const reason = getFeedbackUnavailableReason();
  if (reason) {
    throw new Error(reason);
  }
  telemetryCaptureFeedback(message).catch((e: unknown) => {
    log.warn("captureFeedback failed", e);
    throw e;
  });
}

export function captureException(
  err: unknown,
  props: Record<string, unknown> = {},
): void {
  if (!active()) {
    return;
  }
  const error = err instanceof Error ? err : new Error(String(err));
  telemetryCaptureException(scrubMessage(error.message), error.stack, {
    ...props,
    process: "renderer",
    popout,
    $exception_type: error.name,
  }).catch((e: unknown) => log.warn("captureException failed", e));
}
