/**
 * An hourly heap sample, so a slow leak shows up in the field long before it
 * runs the host out of memory.
 */

import v8 from "node:v8";
import { appState } from "../../state";
import { mcpSessionCount } from "../mcp/sessions";
import { capture } from "./telemetry";

const SAMPLE_INTERVAL_MS = 60 * 60_000;
const MB = 1024 * 1024;

let timer: NodeJS.Timeout | null = null;

export function heapUsedBucket(
  bytes: number,
): "<1GB" | "<2GB" | "<4GB" | "<256MB" | ">=4GB" {
  if (bytes < 256 * MB) {
    return "<256MB";
  }
  if (bytes < 1024 * MB) {
    return "<1GB";
  }
  if (bytes < 2048 * MB) {
    return "<2GB";
  }

  return bytes < 4096 * MB ? "<4GB" : ">=4GB";
}

export function heapLimitBucket(
  used: number,
  limit: number,
): "<25%" | "<50%" | "<75%" | ">=75%" {
  const share = limit > 0 ? used / limit : 0;
  if (share < 0.25) {
    return "<25%";
  }
  if (share < 0.5) {
    return "<50%";
  }

  return share < 0.75 ? "<75%" : ">=75%";
}

export function uptimeBucket(seconds: number): "<1d" | "<3d" | "<6h" | ">=3d" {
  const hours = seconds / 3600;
  if (hours < 6) {
    return "<6h";
  }
  if (hours < 24) {
    return "<1d";
  }

  return hours < 72 ? "<3d" : ">=3d";
}

function sample(): void {
  const { used_heap_size: used, heap_size_limit: limit } =
    v8.getHeapStatistics();
  capture("host_heap_sampled", {
    heap_used_bucket: heapUsedBucket(used),
    heap_limit_bucket: heapLimitBucket(used, limit),
    uptime_bucket: uptimeBucket(process.uptime()),
    agents: appState.agents.size,
    mcp_sessions: mcpSessionCount(),
  });
}

export function startHeapSampling(): void {
  stopHeapSampling();
  timer = setInterval(sample, SAMPLE_INTERVAL_MS);
  timer.unref?.();
}

export function stopHeapSampling(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
