/**
 * Token usage records from Claude Code session transcripts
 * (`~/.claude/projects/**.jsonl`), read incrementally per file.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface UsageRecord {
  /** Unix ms. */
  at: number;
  model: string;
  sessionId: string;
  /** `message.id:requestId`; the CLI repeats a message's usage once per content block. */
  key: string | null;
  input: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  output: number;
}

const tokens = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;

export function parseUsageLine(line: string): UsageRecord | null {
  if (!line.includes('"usage"') || !line.includes('"assistant"')) {
    return null;
  }
  let rec: Record<string, unknown>;
  try {
    rec = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (
    rec.type !== "assistant" ||
    typeof rec.message !== "object" ||
    rec.message === null
  ) {
    return null;
  }
  const message = rec.message as Record<string, unknown>;
  const usage = message.usage as Record<string, unknown> | undefined;
  const at =
    typeof rec.timestamp === "string" ? Date.parse(rec.timestamp) : NaN;
  const model = typeof message.model === "string" ? message.model : "";
  if (
    !usage ||
    typeof usage !== "object" ||
    !Number.isFinite(at) ||
    !model ||
    model === "<synthetic>"
  ) {
    return null;
  }
  const messageId = typeof message.id === "string" ? message.id : null;
  const requestId = typeof rec.requestId === "string" ? rec.requestId : null;
  const created = tokens(usage.cache_creation_input_tokens);
  const split = usage.cache_creation as Record<string, unknown> | undefined;
  const oneHour = split
    ? Math.min(created, tokens(split.ephemeral_1h_input_tokens))
    : 0;

  return {
    at,
    model,
    sessionId: typeof rec.sessionId === "string" ? rec.sessionId : "",
    key:
      messageId === null && requestId === null
        ? null
        : `${messageId ?? ""}:${requestId ?? ""}`,
    input: tokens(usage.input_tokens),
    cacheRead: tokens(usage.cache_read_input_tokens),
    cacheWrite5m: created - oneHour,
    cacheWrite1h: oneHour,
    output: tokens(usage.output_tokens),
  };
}

interface FileState {
  size: number;
  mtimeMs: number;
  /** Bytes consumed, always at a line boundary. */
  offset: number;
  records: UsageRecord[];
}

const files = new Map<string, FileState>();

export function claudeProjectsDir(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

async function listJsonl(
  dir: string,
  out: { path: string; size: number; mtimeMs: number }[],
) {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await listJsonl(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      try {
        const stat = await fs.promises.stat(full);
        out.push({ path: full, size: stat.size, mtimeMs: stat.mtimeMs });
      } catch {
        // Deleted mid-scan.
      }
    }
  }
}

/** Parse what was appended since the last read; a shrunk file is read again. */
async function readFrom(
  file: string,
  state: FileState,
  size: number,
): Promise<void> {
  const handle = await fs.promises.open(file, "r");
  try {
    let pos = state.offset;
    let carry = "";
    const chunk = Buffer.alloc(1 << 20);
    while (pos < size) {
      const { bytesRead } = await handle.read(
        chunk,
        0,
        Math.min(chunk.length, size - pos),
        pos,
      );
      if (bytesRead === 0) {
        break;
      }
      pos += bytesRead;
      const text = carry + chunk.toString("utf8", 0, bytesRead);
      const lines = text.split("\n");
      carry = lines.pop() ?? "";
      for (const line of lines) {
        const rec = parseUsageLine(line);
        if (rec) {
          state.records.push(rec);
        }
      }
    }
    // A trailing partial line is left for the next read.
    state.offset = pos - Buffer.byteLength(carry, "utf8");
  } finally {
    await handle.close();
  }
}

/** Every record from transcripts written to at or after `sinceMs`. */
export async function loadUsageRecords(
  sinceMs: number,
  root = claudeProjectsDir(),
): Promise<UsageRecord[]> {
  const found: { path: string; size: number; mtimeMs: number }[] = [];
  await listJsonl(root, found);
  const out: UsageRecord[] = [];
  for (const f of found) {
    if (f.mtimeMs < sinceMs) {
      continue;
    }
    let state = files.get(f.path);
    if (!state || f.size < state.offset) {
      state = { size: 0, mtimeMs: 0, offset: 0, records: [] };
      files.set(f.path, state);
    }
    if (f.size !== state.size || f.mtimeMs !== state.mtimeMs) {
      try {
        await readFrom(f.path, state, f.size);
        state.size = f.size;
        state.mtimeMs = f.mtimeMs;
      } catch {
        continue;
      }
    }
    for (const r of state.records) {
      out.push(r);
    }
  }

  return out;
}

/** Test seam. */
export function resetUsageRecordCache(): void {
  files.clear();
}
