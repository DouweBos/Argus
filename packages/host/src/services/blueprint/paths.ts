/** Blueprint state lives under `$ARGUS_HOME`, per machine, like automations. */

import os from "node:os";
import path from "node:path";
import { argusHomeDir } from "../../lib/argusHome";

export function blueprintsFilePath(): string {
  return path.join(argusHomeDir(), "blueprints.json");
}

export function blueprintRunsFilePath(): string {
  return path.join(argusHomeDir(), "blueprint-runs.json");
}

/** `~/Work` → `/Users/me/Work`; anything else resolved as given. */
export function expandHome(dir: string): string {
  const trimmed = dir.trim();
  if (trimmed === "~") {
    return os.homedir();
  }
  if (trimmed.startsWith("~/")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }

  return path.resolve(trimmed);
}
