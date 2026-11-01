/**
 * Straight to PostHog over its capture API, with this browser's own install
 * id, as the iOS client does. No SDK: nothing is autocaptured, recorded or
 * profiled, and every request is one this file builds.
 *
 * Privacy rules, the same as the host's and the phone's:
 * - The distinct id is a random UUID in `localStorage`, never linked to an
 *   account or a person (`$process_person_profile: false`), and GeoIP is off.
 * - `presence` (the default) sends one `$pageview` heartbeat per page load and
 *   nothing else; `full` adds the catalog in `events.ts` and `$screen` views,
 *   whose names are route patterns, never ids.
 * - Off entirely when the build has no key.
 */

import type { EventMap, EventName, WebBuild } from "./events";

export type TelemetryMode = "full" | "presence";

const KEY = import.meta.env.VITE_POSTHOG_KEY ?? "";
const HOST = (import.meta.env.VITE_POSTHOG_HOST || "https://eu.i.posthog.com").replace(
  /\/+$/,
  "",
);
// Undefined outside a Vite build (tests).
const APP_VERSION =
  typeof __ARGUS_VERSION__ === "string" ? __ARGUS_VERSION__ : "dev";

const ID_KEY = "argus.telemetry.id";
const MODE_KEY = "argus.telemetry.mode";
const CONSENT_KEY = "argus.telemetry.consent";

let mode: TelemetryMode = "presence";
let build: WebBuild = "network";
let distinctId = "";
let started = false;
let launchedPaired = false;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function installId(): string {
  const store = storage();
  const existing = store?.getItem(ID_KEY);
  if (existing) {
    return existing;
  }
  const id = crypto.randomUUID();
  store?.setItem(ID_KEY, id);

  return id;
}

/** A key is configured, so there is something to consent to. */
export function telemetryConfigured(): boolean {
  return KEY.length > 0;
}

export function telemetryMode(): TelemetryMode {
  return mode;
}

/** The consent question was answered once in this browser. */
export function hasAnsweredConsent(): boolean {
  return storage()?.getItem(CONSENT_KEY) === "yes";
}

function send(event: string, properties: Record<string, unknown>): void {
  if (!KEY) {
    return;
  }
  const body = JSON.stringify({
    api_key: KEY,
    event,
    distinct_id: distinctId,
    timestamp: new Date().toISOString(),
    properties: {
      $lib: "argus-web",
      $process_person_profile: false,
      $geoip_disable: true,
      ...properties,
    },
  });
  // A dropped event is better than an error the user sees.
  fetch(`${HOST}/i/v0/e/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
    credentials: "omit",
  }).catch(() => {});
}

function baseProps(): Record<string, string> {
  return { app_version: APP_VERSION, client: "web", platform: "web", build };
}

/** Once per page load, from the entry point. */
export function startTelemetry(which: WebBuild, paired: boolean): void {
  if (started) {
    return;
  }
  started = true;
  build = which;
  launchedPaired = paired;
  distinctId = installId();
  const stored = storage()?.getItem(MODE_KEY);
  mode = stored === "full" ? "full" : "presence";
  // PostHog counts DAU from `$pageview`, so presence-only browsers count only
  // because of this. A fixed path and the version, nothing else.
  send("$pageview", {
    $current_url: "argus-web:///",
    $pathname: "/",
    app_version: APP_VERSION,
    source: "heartbeat",
  });
  capture("web_launched", { build: which, paired });
}

export function setTelemetryMode(next: TelemetryMode): void {
  const store = storage();
  store?.setItem(CONSENT_KEY, "yes");
  store?.setItem(MODE_KEY, next);
  if (next === mode) {
    return;
  }
  if (next === "full") {
    mode = "full";
    capture("telemetry_enabled");
    capture("web_launched", { build, paired: launchedPaired });

    return;
  }
  // Record the downgrade before the gate closes on it.
  capture("telemetry_disabled");
  mode = "presence";
}

type PropsOf<E extends EventName> = EventMap[E] extends undefined
  ? []
  : [EventMap[E]];

export function capture<E extends EventName>(event: E, ...props: PropsOf<E>): void {
  if (mode !== "full") {
    return;
  }
  send(event, { ...baseProps(), ...(props[0] ?? {}) });
}

/** A screen came up. `pattern` is a route pattern (`screenPattern`), never a path. */
export function captureScreen(pattern: string): void {
  if (mode !== "full") {
    return;
  }
  send("$screen", { ...baseProps(), $screen_name: pattern });
}
