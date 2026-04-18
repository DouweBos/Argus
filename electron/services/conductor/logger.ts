/**
 * Central log + wrapper for every conductor call.
 *
 * Every conductor invocation (spawn + HTTP) is funnelled through this module
 * so the UI can show a "live device log" per-device. Entries are kept in a
 * ring buffer per device key and also broadcast as `conductor:log` IPC events.
 */

import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { getMainWindow } from "../../main";

const execFileAsync = promisify(execFile);

export const CONDUCTOR_BIN = path.join(
  os.homedir(),
  ".argus",
  "bin",
  "conductor",
);

const MAX_ENTRIES_PER_DEVICE = 500;

export type ConductorLogKind = "cli" | "http";

export interface ConductorLogEntry {
  id: number;
  ts: number;
  /** Device key: UDID for iOS sims, serial for Android, conductor deviceId for web browsers. */
  deviceKey: string;
  kind: ConductorLogKind;
  /** Command or HTTP path. */
  command: string;
  /** Argv for cli, or JSON body for http. */
  args: string;
  /** Milliseconds the call took. */
  durationMs: number;
  ok: boolean;
  /** Truncated stdout / response body. */
  output?: string;
  error?: string;
}

class ConductorLogStore {
  private nextId = 1;
  private entries = new Map<string, ConductorLogEntry[]>();

  push(entry: Omit<ConductorLogEntry, "id">): ConductorLogEntry {
    const full: ConductorLogEntry = { ...entry, id: this.nextId++ };
    let bucket = this.entries.get(entry.deviceKey);
    if (!bucket) {
      bucket = [];
      this.entries.set(entry.deviceKey, bucket);
    }
    bucket.push(full);
    if (bucket.length > MAX_ENTRIES_PER_DEVICE) {
      bucket.splice(0, bucket.length - MAX_ENTRIES_PER_DEVICE);
    }
    getMainWindow()?.webContents.send("conductor:log", full);

    return full;
  }

  list(deviceKey: string): ConductorLogEntry[] {
    return this.entries.get(deviceKey)?.slice() ?? [];
  }

  clear(deviceKey: string): void {
    this.entries.delete(deviceKey);
  }
}

export const conductorLogStore = new ConductorLogStore();

function truncate(s: string, max = 2000): string {
  if (s.length <= max) {
    return s;
  }

  return `${s.slice(0, max)}… (+${s.length - max} bytes)`;
}

/**
 * Execute the conductor CLI with logging. The `deviceKey` should be the value
 * that shows up after `--device` (or a best-effort identifier if the call is
 * device-less).
 */
export async function execConductor(
  deviceKey: string,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv },
): Promise<{ stdout: string; stderr: string }> {
  const t0 = Date.now();
  try {
    const result = await execFileAsync(CONDUCTOR_BIN, args, options);
    conductorLogStore.push({
      ts: t0,
      deviceKey,
      kind: "cli",
      command: args[0] ?? "conductor",
      args: args.join(" "),
      durationMs: Date.now() - t0,
      ok: true,
      output: truncate(result.stdout),
    });

    return result;
  } catch (e) {
    const err = e as { message?: string; stderr?: string; stdout?: string };
    conductorLogStore.push({
      ts: t0,
      deviceKey,
      kind: "cli",
      command: args[0] ?? "conductor",
      args: args.join(" "),
      durationMs: Date.now() - t0,
      ok: false,
      output: err.stdout ? truncate(err.stdout) : undefined,
      error: truncate(err.message ?? err.stderr ?? String(e)),
    });
    throw e;
  }
}

/**
 * Log an HTTP call to a conductor driver port. Call from a wrapped HTTP
 * helper; callers pass the path, body, and the final status/ok bit.
 */
function stringifyBody(body: unknown): string {
  if (body === undefined) {
    return "";
  }
  if (typeof body === "string") {
    return body;
  }

  return JSON.stringify(body);
}

export function logConductorHttp(
  deviceKey: string,
  method: string,
  httpPath: string,
  body: unknown,
  startedAt: number,
  result: { ok: boolean; output?: string; error?: string },
): void {
  conductorLogStore.push({
    ts: startedAt,
    deviceKey,
    kind: "http",
    command: `${method} ${httpPath}`,
    args: stringifyBody(body),
    durationMs: Date.now() - startedAt,
    ok: result.ok,
    output: result.output ? truncate(result.output) : undefined,
    error: result.error ? truncate(result.error) : undefined,
  });
}
