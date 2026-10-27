/**
 * Every session an EAS host may have started, recorded by its unique name
 * before Expo is asked to create it, so a host process that dies at any point
 * leaves enough behind for the next one to find and stop the session. Lives
 * in `$ARGUS_HOME/eas-sessions/<hostId>.json`.
 */

import fs from "node:fs";
import path from "node:path";
import { argusHomeDir } from "../../../lib/argusHome";
import { EasError } from "./credential";

export interface LedgerEntry {
  name: string;
  appId: string;
  recordedAt: number;
  /** Expo refused the create: nothing should run, but the sweep still looks. */
  refused?: boolean;
}

function dir(): string {
  return path.join(argusHomeDir(), "eas-sessions");
}

function filePath(hostId: string): string {
  return path.join(dir(), `${hostId}.json`);
}

function isEntry(e: unknown): e is LedgerEntry {
  const x = e as Partial<LedgerEntry> | null;

  return (
    !!x &&
    typeof x.name === "string" &&
    typeof x.appId === "string" &&
    typeof x.recordedAt === "number"
  );
}

/** A missing ledger is empty; an unreadable one is an error, never an empty list. */
export function readLedger(hostId: string): LedgerEntry[] {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath(hostId), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw unreadable(hostId);
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || !parsed.every(isEntry)) {
      throw new Error("bad shape");
    }

    return parsed;
  } catch {
    throw unreadable(hostId);
  }
}

function unreadable(hostId: string): EasError {
  return new EasError(
    "ledger",
    `The record of running EAS sessions at ${filePath(hostId)} could not be read. Fix or remove it.`,
  );
}

export function updateLedger(
  hostId: string,
  update: (entries: LedgerEntry[]) => LedgerEntry[],
): void {
  const entries = update(readLedger(hostId));
  const target = filePath(hostId);
  try {
    fs.mkdirSync(dir(), { recursive: true, mode: 0o700 });
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(entries, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, target);
  } catch {
    throw new EasError(
      "ledger",
      `The record of running EAS sessions at ${target} could not be written.`,
    );
  }
}

/** Hosts with a ledger on disk, including removed ones whose sessions may still run. */
export function ledgerHostIds(): string[] {
  try {
    return fs
      .readdirSync(dir())
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -5));
  } catch {
    return [];
  }
}

export function deleteLedger(hostId: string): void {
  fs.rmSync(filePath(hostId), { force: true });
}
