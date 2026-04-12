/**
 * Per-project slash command usage metrics.
 *
 * Tracks how often each command is used so the autocomplete can sort by
 * popularity. Stored at `{worktreesRoot}/.stagehand-command-metrics.json`.
 *
 * The file is a simple `{ version, counts: { [commandName]: number } }` map.
 */

import fs from "node:fs";
import path from "node:path";
import { worktreesRoot } from "./git";

const METRICS_FILENAME = ".stagehand-command-metrics.json";
const SCHEMA_VERSION = 1;

interface MetricsFile {
  version: number;
  counts: Record<string, number>;
}

function metricsPath(repoRoot: string): string {
  return path.join(worktreesRoot(repoRoot), METRICS_FILENAME);
}

/**
 * Load command usage counts for a project. Returns an empty object if the
 * file is missing or invalid.
 */
export function loadCommandMetrics(repoRoot: string): Record<string, number> {
  const filePath = metricsPath(repoRoot);
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return {};
  }

  try {
    const file = JSON.parse(raw) as MetricsFile;
    if (file.version !== SCHEMA_VERSION) {
      return {};
    }

    return file.counts ?? {};
  } catch {
    return {};
  }
}

/**
 * Save command usage counts to disk.
 */
function saveCommandMetrics(
  repoRoot: string,
  counts: Record<string, number>,
): void {
  const file: MetricsFile = { version: SCHEMA_VERSION, counts };
  const dir = worktreesRoot(repoRoot);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      metricsPath(repoRoot),
      JSON.stringify(file, null, 2),
      "utf8",
    );
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
