/**
 * Per-project slash command usage metrics.
 *
 * Tracks how often each command is used so the autocomplete can sort by
 * popularity. Stored at `~/.argus/projects/{key}/.argus-command-metrics.json` —
 * per project, not per purpose, so automations share the same counts.
 *
 * The file is a simple `{ version, counts: { [commandName]: number } }` map.
 */

import fs from "node:fs";
import path from "node:path";
import { COMMAND_METRICS_FILE, sidecarPath } from "./sidecars";

const SCHEMA_VERSION = 1;

interface MetricsFile {
  version: number;
  counts: Record<string, number>;
}

function readCountsAt(filePath: string): Record<string, number> {
  try {
    const file = JSON.parse(fs.readFileSync(filePath, "utf8")) as MetricsFile;

    return file.version === SCHEMA_VERSION ? (file.counts ?? {}) : {};
  } catch {
    return {};
  }
}

function metricsPath(repoRoot: string): string {
  return sidecarPath(repoRoot, COMMAND_METRICS_FILE);
}

/**
 * Load command usage counts for a project. Returns an empty object if the
 * file is missing or invalid.
 */
export function loadCommandMetrics(repoRoot: string): Record<string, number> {
  return readCountsAt(metricsPath(repoRoot));
}

/**
 * Save command usage counts to disk.
 */
function saveCommandMetrics(
  repoRoot: string,
  counts: Record<string, number>,
): void {
  const file: MetricsFile = { version: SCHEMA_VERSION, counts };
  const target = metricsPath(repoRoot);
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(file, null, 2), "utf8");
  } catch {
    // Non-fatal — metrics are best-effort.
  }
}

/**
 * Increment the usage count for a command. Reads, increments, and writes
 * back in one shot. Suitable for the low frequency of slash command invocations.
 */
export function incrementCommandMetric(
  repoRoot: string,
  commandName: string,
): void {
  const counts = loadCommandMetrics(repoRoot);
  counts[commandName] = (counts[commandName] ?? 0) + 1;
  saveCommandMetrics(repoRoot, counts);
}
