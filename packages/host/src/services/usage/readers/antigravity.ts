/**
 * Token usage from Antigravity's conversation databases (one SQLite file per
 * conversation). Usage sits in protobuf blobs on both the generation and the
 * step rows, often for the same model call, so records sharing a call id merge.
 */

import type { UsageRecord } from "../records";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  isConcreteModel,
  knownModelName,
  normalizeModelName,
  priceableModel,
} from "./antigravityModels";
import {
  dataDirs,
  dbFingerprint,
  tableNames,
  withReadOnlyDb,
  yieldToLoop,
} from "./localFiles";
import {
  decodeProto,
  protoBytes,
  protoMessage,
  protoNumber,
  protoText,
  protoTimestamp,
  type ProtoFields,
} from "./protobuf";

export const ANTIGRAVITY_RUNNER_ID = "antigravity";

interface Tokens {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

interface CallUsage extends Tokens {
  modelId: number;
  /** Call ids, any one of which identifies the call across rows and files. */
  ids: string[];
}

interface Meta {
  model: string;
  modelId: number;
  at: number | null;
  usages: CallUsage[];
}

function callUsage(f: ProtoFields): CallUsage {
  return {
    modelId: protoNumber(f, 1),
    input: protoNumber(f, 2),
    cacheWrite: protoNumber(f, 4),
    cacheRead: protoNumber(f, 5),
    // Field 3 is output; some versions only split it into thinking (9) and text (10).
    output: Math.max(protoNumber(f, 3), protoNumber(f, 9) + protoNumber(f, 10)),
    ids: [11, 12, 7].flatMap((k) => {
      const id = protoText(f, k);

      return id ? [`${k}:${id}`] : [];
    }),
  };
}

/** Step rows and generation rows lay out the same facts under different field numbers. */
function readMeta(bytes: Uint8Array, step: boolean): Meta {
  const root = decodeProto(bytes);
  if (!step && !protoBytes(root, 1)) {
    throw new Error("no generation metadata");
  }
  const data = step ? root : protoMessage(root, 1);
  const model = step ? protoMessage(data, 24) : data;
  const usageBytes = protoBytes(data, step ? 9 : 4);
  const usages = usageBytes ? [callUsage(decodeProto(usageBytes))] : [];
  for (const retry of data.get(step ? 28 : 17) ?? []) {
    const retryUsage =
      retry instanceof Uint8Array ? protoBytes(decodeProto(retry), 2) : null;
    if (retryUsage) {
      usages.push(callUsage(decodeProto(retryUsage)));
    }
  }
  const names = [
    protoText(model, step ? 12 : 19),
    protoText(model, step ? 8 : 21),
  ].map(normalizeModelName);

  return {
    model:
      names.find(isConcreteModel) ??
      names.find((n) => n && !/^model[_-]/.test(n)) ??
      "",
    modelId: protoNumber(model, step ? 1 : 3) || (usages[0]?.modelId ?? 0),
    at: step
      ? (protoTimestamp(protoMessage(data, 8)) ??
        protoTimestamp(protoMessage(data, 1)))
      : protoTimestamp(protoMessage(protoMessage(data, 9), 4)),
    usages,
  };
}

interface Candidate extends Tokens {
  sessionId: string;
  at: number;
  /** 2: the call's own time, 1: the conversation's, 0: the file's. */
  timeQuality: number;
  model: string;
  modelId: number;
  keys: string[];
  fallbackKey: string;
}

interface DbRead {
  candidates: Candidate[];
  /** Concrete names seen per model id; null when one id had two names. */
  models: Map<number, string | null>;
}

function remember(
  models: Map<number, string | null>,
  id: number,
  name: string,
) {
  const prev = models.get(id);
  models.set(id, prev === undefined || prev === name ? name : null);
}

async function readRows(
  db: DatabaseSync,
  sql: string,
  step: boolean,
): Promise<Map<number, Meta>> {
  const out = new Map<number, Meta>();
  let n = 0;
  for (const row of db.prepare(sql).iterate()) {
    if (typeof row.idx === "number" && row.data instanceof Uint8Array) {
      try {
        out.set(row.idx, readMeta(row.data, step));
      } catch {
        // An unreadable blob loses that row, not the conversation.
      }
    }
    if (++n % 64 === 0) {
      await yieldToLoop();
    }
  }

  return out;
}

async function readDatabase(
  db: DatabaseSync,
  sessionId: string,
  fileMtime: number,
): Promise<DbRead> {
  const tables = tableNames(db);
  const generations = tables.has("gen_metadata")
    ? await readRows(db, "SELECT idx, data FROM gen_metadata", false)
    : new Map<number, Meta>();
  const steps = tables.has("steps")
    ? await readRows(
        db,
        "SELECT idx, metadata AS data FROM steps WHERE metadata IS NOT NULL",
        true,
      )
    : new Map<number, Meta>();
  let conversationAt: number | null = null;
  if (tables.has("trajectory_metadata_blob")) {
    for (const row of db
      .prepare("SELECT data FROM trajectory_metadata_blob")
      .iterate()) {
      if (conversationAt === null && row.data instanceof Uint8Array) {
        try {
          conversationAt = protoTimestamp(
            protoMessage(decodeProto(row.data), 2),
          );
        } catch {
          // No conversation time; calls fall back to the file's.
        }
      }
    }
  }

  const models = new Map<number, string | null>();
  const candidates: Candidate[] = [];
  for (const [source, rows] of [
    ["step", steps],
    ["generation", generations],
  ] as const) {
    for (const [idx, meta] of rows) {
      if (meta.modelId > 0 && isConcreteModel(meta.model)) {
        remember(models, meta.modelId, meta.model);
      }
      for (const [i, u] of meta.usages.entries()) {
        if (u.input + u.cacheRead + u.cacheWrite + u.output === 0) {
          continue;
        }
        const modelId = u.modelId || meta.modelId;
        // A retry can run on another model than its step or generation.
        const matches = (m: Meta) => modelId === 0 || m.modelId === modelId;
        const generation = source === "step" ? generations.get(idx) : undefined;
        let model = matches(meta) ? meta.model : "";
        if (!model && generation && matches(generation)) {
          model = generation.model;
        }
        candidates.push({
          sessionId,
          at: meta.at ?? conversationAt ?? fileMtime,
          timeQuality: meta.at !== null ? 2 : Number(conversationAt !== null),
          model,
          modelId,
          keys: u.ids,
          fallbackKey: `${sessionId}:${source}:${idx}:${i}`,
          input: u.input,
          cacheRead: u.cacheRead,
          cacheWrite: u.cacheWrite,
          output: u.output,
        });
      }
    }
  }

  return { candidates, models };
}

interface Group extends Candidate {
  parent: number;
  modelQuality: number;
}

/** Union of candidates sharing any call id; the merged call keeps the best facts of each. */
class CallGroups {
  readonly groups: Group[] = [];
  private readonly byKey = new Map<string, number>();

  add(c: Candidate, modelQuality: number): void {
    const index = this.groups.length;
    this.groups.push({ ...c, parent: index, modelQuality });
    for (const key of c.keys) {
      const existing = this.byKey.get(key);
      if (existing !== undefined) {
        this.union(existing, index);
      }
      this.byKey.set(key, this.find(index));
    }
  }

  find(i: number): number {
    while (this.groups[i].parent !== i) {
      this.groups[i].parent = this.groups[this.groups[i].parent].parent;
      i = this.groups[i].parent;
    }

    return i;
  }

  private union(a: number, b: number): void {
    const [keep, drop] = [this.find(a), this.find(b)].sort((x, y) => x - y);
    if (keep === drop) {
      return;
    }
    const k = this.groups[keep];
    const d = this.groups[drop];
    d.parent = keep;
    if (d.modelQuality > k.modelQuality) {
      k.model = d.model;
      k.modelQuality = d.modelQuality;
    }
    if (
      d.timeQuality > k.timeQuality ||
      (d.timeQuality === k.timeQuality && d.at < k.at)
    ) {
      k.at = d.at;
      k.timeQuality = d.timeQuality;
    }
    k.input = Math.max(k.input, d.input);
    k.cacheRead = Math.max(k.cacheRead, d.cacheRead);
    k.cacheWrite = Math.max(k.cacheWrite, d.cacheWrite);
    k.output = Math.max(k.output, d.output);
    k.keys = [...new Set([...k.keys, ...d.keys])];
  }
}

const dbCache = new Map<string, { fingerprint: string; read: DbRead }>();

async function loadDatabase(
  file: string,
  mtimeMs: number,
): Promise<DbRead | null> {
  const fingerprint = await dbFingerprint(file);
  if (!fingerprint) {
    return null;
  }
  const cached = dbCache.get(file);
  if (cached?.fingerprint === fingerprint) {
    return cached.read;
  }
  const sessionId = path.basename(file, ".db");
  const read = await withReadOnlyDb(file, (db) =>
    readDatabase(db, sessionId, mtimeMs),
  );
  if (read) {
    dbCache.set(file, { fingerprint, read });
  }

  return read ?? cached?.read ?? null;
}

async function listDatabases(dir: string, out: Map<string, number>) {
  const entries = await fs.promises
    .readdir(dir, { withFileTypes: true })
    .catch(() => []);
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await listDatabases(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".db")) {
      const real = await fs.promises.realpath(full).catch(() => full);
      const stat = await fs.promises.stat(real).catch(() => null);
      if (stat && !out.has(real)) {
        out.set(real, stat.mtimeMs);
      }
    }
  }
}

export function antigravityDataDirs(): Promise<string[]> {
  const home = os.homedir();

  return dataDirs("ANTIGRAVITY_DATA_DIR", [
    ...[
      "antigravity",
      "antigravity-cli",
      "antigravity-ide",
      "antigravity-backup",
    ].map((name) => path.join(home, ".gemini", name)),
    path.join(home, ".config", "antigravity"),
  ]);
}

/** Every model call recorded at or after `sinceMs`. */
export async function loadAntigravityUsageRecords(
  sinceMs: number,
  roots?: string[],
): Promise<UsageRecord[]> {
  const files = new Map<string, number>();
  for (const root of roots ?? (await antigravityDataDirs())) {
    const nested = path.join(root, "conversations");
    const dir = fs.existsSync(nested) ? nested : root;
    await listDatabases(dir, files);
  }
  const reads: DbRead[] = [];
  for (const [file, mtimeMs] of files) {
    // Calls can't postdate their conversation's last write.
    if (mtimeMs < sinceMs) {
      continue;
    }
    const read = await loadDatabase(file, mtimeMs);
    if (read) {
      reads.push(read);
    }
  }

  const learned = new Map<number, string | null>();
  for (const read of reads) {
    for (const [id, name] of read.models) {
      if (name) {
        remember(learned, id, name);
      }
    }
  }
  const groups = new CallGroups();
  for (const read of reads) {
    for (const c of read.candidates) {
      const concrete = isConcreteModel(c.model) ? c.model : "";
      const fromHistory = learned.get(c.modelId) ?? "";
      const fallback =
        learned.get(c.modelId) === null
          ? ""
          : (knownModelName(c.modelId) ?? "");
      const model =
        concrete ||
        fromHistory ||
        fallback ||
        c.model ||
        (c.modelId > 0 ? `antigravity-model-${c.modelId}` : "antigravity");
      const quality = [concrete, fromHistory, fallback, c.model].findIndex(
        Boolean,
      );
      // Concrete 4, learned 3, known id 2, any name 1, none 0.
      groups.add({ ...c, model }, quality < 0 ? 0 : 4 - quality);
    }
  }

  return groups.groups.flatMap((g, i) =>
    g.parent === i && g.at >= sinceMs
      ? [
          {
            at: g.at,
            runner: ANTIGRAVITY_RUNNER_ID,
            model: priceableModel(g.model),
            sessionId: g.sessionId,
            key: g.keys[0] ?? g.fallbackKey,
            input: g.input,
            cacheRead: g.cacheRead,
            cacheWrite5m: g.cacheWrite,
            cacheWrite1h: 0,
            output: g.output,
            costUsd: null,
          },
        ]
      : [],
  );
}

/** Test seam. */
export function resetAntigravityUsageCache(): void {
  dbCache.clear();
}
