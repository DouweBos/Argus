/**
 * Renderer telemetry. Wraps posthog-js with strict privacy defaults.
 *
 * - Anonymous distinct id is provided by the main process (random UUID
 *   stored under `~/.argus/telemetry-id`).
 * - No autocapture, no session recording, no IP, no person profiles.
 * - Off when the user opts out via Settings.
 * - Off when `VITE_POSTHOG_KEY` isn't configured at build time.
 *
 * Renderer-only events (UI clicks, navigation) capture here. Anything that
 * happens in the main process (crashes, child-process errors, lifecycle)
 * captures via `electron/services/telemetry` so it survives renderer death.
 */
import type { EventArgs, EventMap, EventName } from "./telemetryEvents";
import posthog from "posthog-js";
import { setTelemetryEnabledOnMain } from "./ipc";
import { createLogger, setErrorSink } from "./logger";

const log = createLogger("telemetry");

const API_KEY = (import.meta.env.VITE_POSTHOG_KEY as string | undefined) ?? "";
const HOST =
  (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ??
  "https://eu.i.posthog.com";

let initialized = false;
let enabled = true;

function active(): boolean {
  return initialized && enabled && Boolean(API_KEY);
}

/**
 * Initialize PostHog. Call once at renderer startup.
 *
 * `distinctId` is generated and persisted by the main process; we never
 * fall back to PostHog's auto-generated id (which would be per-render,
 * not per-install).
 */
export function initTelemetry(opts: {
  appVersion: string;
  distinctId: string;
  enabled: boolean;
}): void {
  enabled = opts.enabled;

  // eslint-disable-next-line no-constant-condition, no-constant-binary-expression
  if (false && !import.meta.env.PROD) {
    log.info("disabled — dev build");
    enabled = false;

    return;
  }

  if (!API_KEY) {
    log.info("disabled — no VITE_POSTHOG_KEY configured");

    return;
  }

  posthog.init(API_KEY, {
    api_host: HOST,
    bootstrap: { distinctID: opts.distinctId },
    persistence: "localStorage",
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    disable_surveys: true,
    person_profiles: "never",
    ip: false,
    opt_out_capturing_by_default: !opts.enabled,
    loaded: (ph) => {
      ph.register({
        app_version: opts.appVersion,
        platform: navigator.platform,
        process: "renderer",
      });
    },
  });

  initialized = true;

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
  if (initialized) {
    if (next) {
      posthog.opt_in_capturing();
    } else {
      posthog.opt_out_capturing();
    }
  }
  // Mirror to main process so its capture path follows the same toggle.
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
  try {
    posthog.capture(event, props);
  } catch (e) {
    log.warn("capture failed", e);
  }
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
 * Capture a free-form feedback message as a `user_feedback` event.
 * Throws when telemetry can't deliver (dev build, missing key, opt-out)
 * so the dialog can surface that state to the user instead of silently
 * dropping their message.
 */
/**
 * Returns a human-readable reason if the feedback channel can't currently
 * deliver, or null when it can. UI can surface this up-front instead of
 * waiting for `captureFeedback` to throw on submit.
 */
export function getFeedbackUnavailableReason(): string | null {
  if (!API_KEY) {
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

export function captureFeedback(message: string): void {
  const reason = getFeedbackUnavailableReason();
  if (reason) {
    throw new Error(reason);
  }
  try {
    posthog.capture("user_feedback", {
      $set_once: { has_submitted_feedback: true },
      message,
    });
  } catch (e) {
    log.warn("captureFeedback failed", e);
    throw e;
  }
}

export function captureException(
  err: unknown,
  props: Record<string, unknown> = {},
): void {
  if (!active()) {
    return;
  }
  const error = err instanceof Error ? err : new Error(String(err));
  try {
    posthog.capture("$exception", {
      ...props,
      $exception_type: error.name,
      $exception_message: scrubMessage(error.message),
      $exception_stack_trace_raw: error.stack
        ? scrubMessage(error.stack)
        : undefined,
      $exception_level: "error",
    });
  } catch (e) {
    log.warn("captureException failed", e);
  }
}
