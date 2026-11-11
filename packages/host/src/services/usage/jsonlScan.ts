/**
 * Incremental reads of append-only JSONL files: each file is parsed once and
 * only what was appended since is read again. A shrunk file starts over.
 */

import fs from "node:fs";
import path from "node:path";

/** Parses one line; `state` is the file's own, carried between lines and reads. */
export type LineParser<R, S> = (line: string, state: S) => R | R[] | null;

interface FileState<R, S> {
  size: number;
  mtimeMs: number;
  /** Bytes consumed, always at a line boundary. */
  offset: number;
  records: R[];
  parser: S;
}

export interface JsonlFile {
  path: string;
  size: number;
  mtimeMs: number;
}

export async function listJsonl(
  dir: string,
  out: JsonlFile[] = [],
  match: (name: string) => boolean = (n) => n.endsWith(".jsonl"),
): Promise<JsonlFile[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await listJsonl(full, out, match);
    } else if (entry.isFile() && match(entry.name)) {
      try {
        const stat = await fs.promises.stat(full);
        out.push({ path: full, size: stat.size, mtimeMs: stat.mtimeMs });
      } catch {
        // Deleted mid-scan.
      }
    }
  }

  return out;
}

export class JsonlScanner<R, S = undefined> {
  private readonly files = new Map<string, FileState<R, S>>();

  constructor(
    private readonly parse: LineParser<R, S>,
    private readonly initial: () => S,
  ) {}

  /** Every record from the given files, reading only what changed since last time. */
  async records(found: JsonlFile[]): Promise<R[]> {
    const out: R[] = [];
    for (const f of found) {
      let state = this.files.get(f.path);
      if (!state || f.size < state.offset) {
        state = {
          size: 0,
          mtimeMs: 0,
          offset: 0,
          records: [],
          parser: this.initial(),
        };
        this.files.set(f.path, state);
      }
      if (f.size !== state.size || f.mtimeMs !== state.mtimeMs) {
        try {
          await this.readFrom(f.path, state, f.size);
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

  reset(): void {
    this.files.clear();
  }

  private async readFrom(
    file: string,
    state: FileState<R, S>,
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
          const parsed = this.parse(line, state.parser);
          if (Array.isArray(parsed)) {
            state.records.push(...parsed);
          } else if (parsed) {
            state.records.push(parsed);
          }
        }
      }
      // A trailing partial line is left for the next read.
      state.offset = pos - Buffer.byteLength(carry, "utf8");
    } finally {
      await handle.close();
    }
  }
}
