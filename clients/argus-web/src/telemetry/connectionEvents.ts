/**
 * Dropped and recovered connections, so "does the web client stay connected"
 * has an answer. Durations are bucketed; a host switch or sign-out is not a
 * drop (`hostSync` resets this first).
 */

import { durationBucket } from "./events";
import { capture } from "./telemetry";

let readyAt: number | null = null;
let lostAt: number | null = null;

export function connectionReady(now = Date.now()): void {
  if (readyAt !== null) {
    return;
  }
  if (lostAt !== null) {
    capture("web_reconnected", { offline_bucket: durationBucket(now - lostAt) });
    lostAt = null;
  }
  readyAt = now;
}

export function connectionDown(now = Date.now()): void {
  if (readyAt === null) {
    return;
  }
  capture("web_connection_lost", {
    connected_bucket: durationBucket(now - readyAt),
  });
  readyAt = null;
  lostAt = now;
}

/** A deliberate change of host: nothing was lost. */
export function connectionForgotten(): void {
  readyAt = null;
  lostAt = null;
}
