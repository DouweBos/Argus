/**
 * Which usage windows were already warned about, in `~/.argus/usage-warnings.json`,
 * so a restart inside the same window doesn't warn again.
 */

import type { FiredWarnings } from "./usageWarnings";
import fs from "node:fs";
import path from "node:path";
import { warn } from "@argus/host/logger";
import { argusHomeDir } from "../../lib/argusHome";

function logPath(): string {
  return path.join(argusHomeDir(), "usage-warnings.json");
}

export function loadFiredWarnings(): FiredWarnings {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(logPath(), "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as FiredWarnings;
    }
  } catch {
    // Missing or unreadable: nothing was warned about yet.
  }

  return {};
}

export function saveFiredWarnings(fired: FiredWarnings): void {
  const file = logPath();
  const tmp = `${file}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(fired, null, 2));
    fs.renameSync(tmp, file);
  } catch (e) {
    warn(`[usage] could not save usage warnings: ${String(e)}`);
  }
}
