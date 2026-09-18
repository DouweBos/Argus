/**
 * The versioned-envelope JSON files automations, runs and proposals all use.
 *
 * A schema mismatch renames the file to `.bak` and starts fresh: this state is
 * cheap to recreate and a half-understood file is worse than none.
 */

import fs from "node:fs";
import path from "node:path";
import { info, warn } from "@argus/host/logger";

function backup(filePath: string, label: string): void {
  try {
    fs.renameSync(filePath, `${filePath}.bak`);
    info(`${label} schema mismatch; backed up to ${filePath}.bak`);
  } catch (e) {
    warn(`Failed to back up ${label}: ${String(e)}`);
  }
}

/** Read `{ version, [key]: T[] }`. Returns `[]` for anything unusable. */
export function readEnvelope<T>(
  filePath: string,
  label: string,
  key: string,
  schemaVersion: number,
): T[] {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }

  let file: Record<string, unknown>;
  try {
    file = JSON.parse(raw) as Record<string, unknown>;
  } catch (e) {
    warn(`Failed to parse ${label}:`, e);

    return [];
  }

  if (file.version !== schemaVersion || !Array.isArray(file[key])) {
    backup(filePath, label);

    return [];
  }

  return file[key] as T[];
}

/** Write atomically through a temp file, creating the directory if needed. */
export function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}
