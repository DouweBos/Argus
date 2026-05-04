/**
 * Stable, anonymous installation id for telemetry.
 *
 * Persisted under `~/.argus/telemetry-id`. Generated once per install and
 * never linked to anything user-identifiable. Wiping the file resets the id.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { argusHomeDir } from "../../lib/argusHome";

const ID_FILE = path.join(argusHomeDir(), "telemetry-id");

let cached: string | null = null;

export function getAnonymousId(): string {
  if (cached) {
    return cached;
  }
  try {
    if (fs.existsSync(ID_FILE)) {
      const raw = fs.readFileSync(ID_FILE, "utf8").trim();
      if (raw) {
        cached = raw;

        return raw;
      }
    }
  } catch {
    // fall through and regenerate
  }

  const id = randomUUID();
  try {
    fs.mkdirSync(path.dirname(ID_FILE), { recursive: true });
    fs.writeFileSync(ID_FILE, id, { mode: 0o600 });
  } catch {
    // ephemeral id; better than nothing
  }
  cached = id;

  return id;
}
