/**
 * Shared plumbing for readers of other runners' local histories: data dirs
 * from the environment and read-only SQLite access.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type * as NodeSqlite from "node:sqlite";
import type { DatabaseSync } from "node:sqlite";

export function expandHome(p: string): string {
  if (p === "~") {
    return os.homedir();
  }

  return p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
}

/** A comma-separated list of dirs from `name`, else the defaults; resolved and deduped. */
export async function dataDirs(
  name: string,
  defaults: string[],
): Promise<string[]> {
  const configured = (process.env[name] ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  const out = new Set<string>();
  for (const dir of configured.length > 0 ? configured : defaults) {
    const resolved = path.resolve(expandHome(dir));
    out.add(await fs.promises.realpath(resolved).catch(() => resolved));
  }

  return [...out];
}

/** Size and mtime of a database and its WAL, which holds rows not yet checkpointed. */
export async function dbFingerprint(file: string): Promise<string | null> {
  const part = async (f: string) => {
    const s = await fs.promises.stat(f).catch(() => null);

    return s ? `${s.size}:${s.mtimeMs}` : "-";
  };
  const main = await part(file);

  return main === "-" ? null : `${main}/${await part(`${file}-wal`)}`;
}

type SqliteModule = typeof NodeSqlite;
let sqlite: Promise<SqliteModule | null> | null = null;

/** `node:sqlite` needs Node 22.5+; an older headless host skips these histories. */
function loadSqlite(): Promise<SqliteModule | null> {
  sqlite ??= import("node:sqlite").catch(() => null);

  return sqlite;
}

/** Runs `read` on a read-only connection; null when the file can't be opened or read. */
export async function withReadOnlyDb<T>(
  file: string,
  read: (db: DatabaseSync) => Promise<T> | T,
): Promise<T | null> {
  const mod = await loadSqlite();
  if (!mod) {
    return null;
  }
  let db: DatabaseSync | null = null;
  try {
    db = new mod.DatabaseSync(file, { readOnly: true });
    // A live writer's lock should fail the read, not stall the host.
    db.exec("PRAGMA busy_timeout = 100");

    return await read(db);
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

export function tableNames(db: DatabaseSync): Set<string> {
  return new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => String(r.name)),
  );
}

export function columnNames(db: DatabaseSync, table: string): Set<string> {
  return new Set(
    db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((r) => String(r.name)),
  );
}

/** Lets the event loop breathe during long synchronous SQLite scans. */
export const yieldToLoop = () =>
  new Promise<void>((resolve) => setImmediate(resolve));
