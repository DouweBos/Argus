/**
 * Token usage from OpenCode's own history: the `opencode*.db` SQLite
 * databases in its data dir and the per-message JSON files older versions
 * kept under `storage/message/`.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { tokenCount, type UsageRecord } from "../records";
import {
  columnNames,
  dataDirs,
  dbFingerprint,
  tableNames,
  withReadOnlyDb,
  yieldToLoop,
} from "./localFiles";

export const OPENCODE_RUNNER_ID = "opencode";

type Json = Record<string, unknown>;

const isRecord = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const text = (v: unknown): string => (typeof v === "string" ? v : "");

function parseJson(v: unknown): unknown {
  if (typeof v !== "string") {
    return v;
  }
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

/** The fields of one stored message that carry usage. */
export interface OpenCodeMessage {
  id?: unknown;
  sessionID?: unknown;
  role?: unknown;
  tokens?: unknown;
  cost?: unknown;
  modelID?: unknown;
  model?: unknown;
  time?: unknown;
}

export function openCodeRecord(
  msg: OpenCodeMessage,
  fallback: { id?: string; sessionId?: string; at?: number } = {},
): UsageRecord | null {
  if (msg.role !== undefined && msg.role !== null && msg.role !== "assistant") {
    return null;
  }
  const tokens = isRecord(msg.tokens) ? msg.tokens : {};
  const cache = isRecord(tokens.cache) ? tokens.cache : {};
  const ref = isRecord(msg.model) ? msg.model : {};
  const model =
    text(ref.id) || text(ref.modelID) || text(msg.modelID) || text(msg.model);
  const created = isRecord(msg.time) ? msg.time.created : undefined;
  const at = typeof created === "number" ? created : fallback.at;
  if (!model || typeof at !== "number" || !Number.isFinite(at)) {
    return null;
  }
  const input = tokenCount(tokens.input);
  const cacheRead = tokenCount(cache.read);
  const cacheWrite = tokenCount(cache.write);
  const output = tokenCount(tokens.output) + tokenCount(tokens.reasoning);
  if (input + cacheRead + cacheWrite + output === 0) {
    return null;
  }
  const id = fallback.id || text(msg.id);
  const cost = msg.cost;

  return {
    at,
    runner: OPENCODE_RUNNER_ID,
    model,
    sessionId: fallback.sessionId || text(msg.sessionID),
    key: id || null,
    input,
    cacheRead,
    cacheWrite5m: cacheWrite,
    cacheWrite1h: 0,
    output,
    // OpenCode writes 0 for unknown rates and subscriptions; price those from the list.
    costUsd:
      typeof cost === "number" && Number.isFinite(cost) && cost > 0
        ? cost
        : null,
  };
}

// Project the usage fields in SQLite: message bodies can be megabytes.
const PROJECTION = `json_extract(data, '$.role') AS role,
  json_extract(data, '$.tokens') AS tokens, json_extract(data, '$.cost') AS cost,
  json_extract(data, '$.modelID') AS modelID, json_extract(data, '$.model') AS model,
  json_extract(data, '$.time.created') AS created_at`;

async function readDatabase(
  db: DatabaseSync,
  sinceMs: number,
): Promise<UsageRecord[]> {
  const out: UsageRecord[] = [];
  const tables = tableNames(db);
  for (const table of ["message", "session_message"]) {
    if (!tables.has(table)) {
      continue;
    }
    const columns = columnNames(db, table);
    if (!columns.has("data")) {
      continue;
    }
    const where = ["typeof(data) = 'text'", "json_valid(data)"];
    const params: number[] = [];
    if (table === "session_message" && columns.has("type")) {
      where.push("type = 'assistant'");
    }
    if (columns.has("time_created")) {
      where.push("time_created >= ?");
      params.push(sinceMs);
    }
    const select = [
      columns.has("id") ? "id" : "NULL AS id",
      columns.has("session_id") ? "session_id" : "NULL AS session_id",
      columns.has("time_created") ? "time_created" : "NULL AS time_created",
      PROJECTION,
    ].join(", ");
    const stmt = db.prepare(
      `SELECT ${select} FROM ${table} WHERE ${where.join(" AND ")}`,
    );
    let n = 0;
    for (const row of stmt.iterate(...params)) {
      const rec = openCodeRecord(
        {
          role: row.role,
          tokens: parseJson(row.tokens),
          cost: row.cost,
          modelID: row.modelID,
          model: parseJson(row.model),
          time: { created: row.created_at ?? row.time_created },
        },
        { id: text(row.id), sessionId: text(row.session_id) },
      );
      if (rec && rec.at >= sinceMs) {
        out.push(rec);
      }
      if (++n % 500 === 0) {
        await yieldToLoop();
      }
    }
  }

  return out;
}

interface CachedDb {
  fingerprint: string;
  sinceMs: number;
  records: UsageRecord[];
}

interface CachedFile {
  mtimeMs: number;
  size: number;
  record: UsageRecord | null;
}

const dbCache = new Map<string, CachedDb>();
const fileCache = new Map<string, CachedFile>();

async function loadDatabase(
  file: string,
  sinceMs: number,
): Promise<UsageRecord[]> {
  const fingerprint = await dbFingerprint(file);
  if (!fingerprint) {
    return [];
  }
  const cached = dbCache.get(file);
  if (cached?.fingerprint === fingerprint && cached.sinceMs <= sinceMs) {
    return cached.records;
  }
  const records = await withReadOnlyDb(file, (db) => readDatabase(db, sinceMs));
  if (records) {
    dbCache.set(file, { fingerprint, sinceMs, records });
  }

  return records ?? cached?.records ?? [];
}

/** `storage/message/<session>/<message>.json`, from before OpenCode moved to SQLite. */
async function loadLegacyMessages(
  root: string,
  sinceMs: number,
  seen: Set<string>,
  out: UsageRecord[],
): Promise<void> {
  const dirs = [path.join(root, "storage", "message")];
  while (dirs.length > 0) {
    const dir = dirs.pop() as string;
    const entries = await fs.promises
      .readdir(dir, { withFileTypes: true })
      .catch(() => []);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        dirs.push(full);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      const id = entry.name.slice(0, -".json".length);
      if (seen.has(id)) {
        continue;
      }
      const stat = await fs.promises.stat(full).catch(() => null);
      // A message can't postdate its file.
      if (!stat || stat.mtimeMs < sinceMs) {
        continue;
      }
      let cached = fileCache.get(full);
      if (cached?.mtimeMs !== stat.mtimeMs || cached.size !== stat.size) {
        const raw = await fs.promises.readFile(full, "utf8").catch(() => null);
        const parsed = raw === null ? null : parseJson(raw);
        cached = {
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          record: isRecord(parsed) ? openCodeRecord(parsed, { id }) : null,
        };
        fileCache.set(full, cached);
      }
      if (cached.record && cached.record.at >= sinceMs) {
        seen.add(id);
        out.push(cached.record);
      }
    }
  }
}

export function openCodeDataDirs(): Promise<string[]> {
  const xdg = process.env.XDG_DATA_HOME?.trim();
  const base =
    xdg && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), ".local/share");

  return dataDirs("OPENCODE_DATA_DIR", [path.join(base, "opencode")]);
}

const isDatabase = (name: string) =>
  /^opencode(?:-[a-zA-Z0-9_-]+)?\.db$/.test(name);

/** Every OpenCode message with usage at or after `sinceMs`. */
export async function loadOpenCodeUsageRecords(
  sinceMs: number,
  roots?: string[],
): Promise<UsageRecord[]> {
  const out: UsageRecord[] = [];
  const seen = new Set<string>();
  for (const root of roots ?? (await openCodeDataDirs())) {
    const names = await fs.promises.readdir(root).catch(() => []);
    // The main database first, so its rows win over channel copies.
    const databases = names
      .filter(isDatabase)
      .sort(
        (a, b) =>
          Number(b === "opencode.db") - Number(a === "opencode.db") ||
          a.localeCompare(b),
      );
    for (const name of databases) {
      for (const rec of await loadDatabase(path.join(root, name), sinceMs)) {
        if (rec.key !== null) {
          if (seen.has(rec.key)) {
            continue;
          }
          seen.add(rec.key);
        }
        out.push(rec);
      }
    }
    await loadLegacyMessages(root, sinceMs, seen, out);
  }

  return out;
}

/** Test seam. */
export function resetOpenCodeUsageCache(): void {
  dbCache.clear();
  fileCache.clear();
}
