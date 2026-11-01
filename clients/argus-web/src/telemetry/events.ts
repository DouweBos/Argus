/**
 * Every event the web client sends, with its props — the browser's twin of
 * `packages/host/src/telemetryEvents.ts` and the iOS `TelemetryEvent`, with
 * the same guarantee: wrong props don't compile. Documented in
 * `docs/telemetry-events.md` (Web client), which `telemetryDocs.test.ts`
 * holds this file to.
 *
 * Only what the computer can't see: it already captures `agent_started`,
 * `session_created`, `session_merged` and the rest when this client asks.
 */

/** Which bundle is running: served by the computer, or the hosted app. */
export type WebBuild = "hosted" | "network";

/** How long something lasted, never the exact duration. */
export type DurationBucket = "<10s" | "10s-1m" | "1m-10m" | "10m-1h" | "1h+";

/** Where a launch URL came from. */
export type LinkSource = "link" | "notification";

export interface EventMap {
  web_launched: { build: WebBuild; paired: boolean };
  web_paired: { has_control: boolean };
  web_pair_failed: { reason: "invalid_code" | "failed" };
  web_link_opened: { screen: string; via: LinkSource; fallback: boolean };
  web_connection_lost: { connected_bucket: DurationBucket };
  web_reconnected: { offline_bucket: DurationBucket };
  web_host_switched: { computer_count: number };
  telemetry_enabled: undefined;
  telemetry_disabled: undefined;
}

export type EventName = keyof EventMap;

export function durationBucket(ms: number): DurationBucket {
  if (ms < 10_000) {
    return "<10s";
  }
  if (ms < 60_000) {
    return "10s-1m";
  }
  if (ms < 600_000) {
    return "1m-10m";
  }

  return ms < 3_600_000 ? "10m-1h" : "1h+";
}
