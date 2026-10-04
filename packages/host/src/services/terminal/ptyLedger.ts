/**
 * The pids of the PTYs this host started, kept under its `ARGUS_HOME`. After a
 * crash it is the only way to tell this host's orphaned spawn-helpers from
 * those of another Argus on the same Mac.
 */

import fs from "node:fs";
import path from "node:path";
import { argusHomeDir } from "../../lib/argusHome";

function ledgerPath(): string {
  return path.join(argusHomeDir(), "pty-pids.json");
}

function read(): number[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(ledgerPath(), "utf8"));

    return Array.isArray(parsed)
      ? parsed.filter((p): p is number => Number.isInteger(p) && p > 1)
      : [];
  } catch {
    return [];
  }
}

function write(pids: number[]): void {
  try {
    const target = ledgerPath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(`${target}.tmp`, JSON.stringify(pids));
    fs.renameSync(`${target}.tmp`, target);
  } catch {
    // Best effort: losing the ledger only means an orphan isn't reaped.
  }
}

export function recordPty(pid: number): void {
  write([...new Set([...read(), pid])]);
}

export function forgetPty(pid: number): void {
  const pids = read();
  if (pids.includes(pid)) {
    write(pids.filter((p) => p !== pid));
  }
}

/** What the previous run left, emptying the ledger for this one. */
export function takePtyLedger(): number[] {
  const pids = read();
  write([]);

  return pids;
}
