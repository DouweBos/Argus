/**
 * Device hosts: other Macs whose simulators Argus streams over SSH. They belong
 * to the machine running the host, which resolves the SSH config and keys, so
 * they persist in `$ARGUS_HOME/device-hosts.json` rather than a project file.
 * EAS Simulator hosts sit in the same file under `easHosts`, apart from
 * `hosts`, so a reader that predates them still parses the file.
 */

import type { DeviceHostInput } from "@argus/remote-protocol";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { warn } from "@argus/host/logger";
import { argusHomeDir } from "../../lib/argusHome";

export interface DeviceHostConfig {
  id: string;
  identityFile: string | null;
  label: string;
  port: number | null;
  target: string;
}

const SCHEMA_VERSION = 1;

/** `rh` + 8 hex: can't collide with a UDID or serial, and is safe in an id. */
const HOST_ID = /^rh[0-9a-f]{8}$/;

/** An ssh_config alias or `[user@]host` — no spaces, no leading dash, no shell. */
const TARGET = /^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9._:-]+$/;

export function isDeviceHostId(id: string): boolean {
  return HOST_ID.test(id);
}

export function newDeviceHostId(): string {
  return `rh${randomBytes(4).toString("hex")}`;
}

function expandHome(p: string): string {
  if (p === "~") {
    return os.homedir();
  }

  return p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
}

/**
 * Validate and normalise what the user typed. Throws a sentence to show. Every
 * field ends up as an ssh argv element, never in a shell, but the leading-dash
 * and charset rules still stop a value being read as an ssh option.
 */
export function normalizeDeviceHostInput(
  input: DeviceHostInput,
): Omit<DeviceHostConfig, "id"> {
  const target = input.target.trim();
  if (!target) {
    throw "Enter an SSH alias or user@host.";
  }
  if (target.startsWith("-") || !TARGET.test(target) || target.length > 255) {
    throw "The SSH target must be an alias from your SSH config or user@host, with no spaces.";
  }

  let port: number | null = null;
  if (input.port !== null && input.port !== undefined) {
    if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
      throw "The port must be a whole number between 1 and 65535.";
    }
    port = input.port;
  }

  let identityFile: string | null = null;
  const rawIdentity = input.identityFile?.trim();
  if (rawIdentity) {
    const expanded = expandHome(rawIdentity);
    if (!path.isAbsolute(expanded) || /[\n\r\0]/.test(expanded)) {
      throw "The identity file must be an absolute path (or start with ~/).";
    }
    identityFile = path.normalize(expanded);
  }

  const label = input.label?.trim() || target.replace(/^[^@]*@/, "");
  if (label.length > 64) {
    throw "Keep the label under 64 characters.";
  }

  return { target, port, identityFile, label };
}

function filePath(): string {
  return path.join(argusHomeDir(), "device-hosts.json");
}

/** Saved hosts, dropping any entry that no longer validates. */
export function loadDeviceHosts(): DeviceHostConfig[] {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath(), "utf8");
  } catch {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as {
      hosts?: unknown[];
      version?: number;
    };
    if (parsed.version !== SCHEMA_VERSION || !Array.isArray(parsed.hosts)) {
      return [];
    }

    return parsed.hosts.flatMap((entry) => {
      const e = entry as Partial<DeviceHostConfig>;
      if (typeof e.id !== "string" || !isDeviceHostId(e.id)) {
        return [];
      }
      try {
        return [
          {
            id: e.id,
            ...normalizeDeviceHostInput({
              target: String(e.target ?? ""),
              port: e.port,
              identityFile: e.identityFile,
              label: e.label,
            }),
          },
        ];
      } catch {
        return [];
      }
    });
  } catch (e) {
    warn("Failed to parse device-hosts.json:", e);

    return [];
  }
}

export function saveDeviceHosts(hosts: DeviceHostConfig[]): void {
  writeDeviceHostsFile({ hosts });
}

/** The file's other keys (EAS hosts), so a write of one list keeps the rest. */
function readDeviceHostsFile(): Record<string, unknown> {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(), "utf8")) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed as { version?: unknown }).version === SCHEMA_VERSION
    ) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Missing or unreadable: start over.
  }

  return {};
}

/** Raw value of a top-level key, for lists kept apart from `hosts`. */
export function readDeviceHostsKey(key: string): unknown {
  return readDeviceHostsFile()[key];
}

/** Replace some top-level keys and keep the others. */
export function writeDeviceHostsFile(patch: Record<string, unknown>): void {
  const target = filePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  const next = {
    hosts: [],
    ...readDeviceHostsFile(),
    ...patch,
    version: SCHEMA_VERSION,
  };
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(tmp, target);
}
