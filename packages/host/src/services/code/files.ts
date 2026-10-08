/**
 * The code editor's file IO. Reads are versioned by the SHA-1 of the bytes on
 * disk; writes are atomic and refuse to clobber a file that moved on since the
 * editor read it — agents write these worktrees constantly.
 *
 * Errors are thrown as plain strings to match IPC error handling.
 */

import type {
  CodeFile,
  CodeReadOnlyReason,
  CodeWriteResult,
} from "@argus/remote-protocol";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveContainedPath } from "../file/operations";

/** Matches `read_file`. */
export const MAX_EDITABLE_BYTES = 5 * 1024 * 1024;

export function sha1(bytes: Buffer): string {
  return crypto.createHash("sha1").update(bytes).digest("hex");
}

function eolOf(text: string): "crlf" | "lf" {
  const lf = text.indexOf("\n");

  return lf > 0 && text[lf - 1] === "\r" ? "crlf" : "lf";
}

function unreadable(bytes: Buffer): CodeReadOnlyReason | null {
  const checkLen = Math.min(bytes.length, 8192);
  for (let i = 0; i < checkLen; i++) {
    if (bytes[i] === 0) {
      return "binary";
    }
  }
  const text = bytes.toString("utf8");

  return Buffer.byteLength(text, "utf8") === bytes.length ? null : "encoding";
}

export async function readCodeFile(
  id: string,
  relativePath: string,
): Promise<CodeFile> {
  const target = await resolveContainedPath(id, relativePath, {
    mustExist: true,
  });
  const stat = await fs.promises.stat(target).catch((e: unknown) => {
    throw `Failed to read file metadata: ${String(e)}`;
  });
  if (!stat.isFile()) {
    throw `Not a file: ${relativePath}`;
  }
  if (stat.size > MAX_EDITABLE_BYTES) {
    // Hash what's there anyway, so a watcher event still compares equal.
    const hash = sha1(await fs.promises.readFile(target));

    return {
      content: "",
      hash,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      eol: "lf",
      readOnlyReason: "too_large",
    };
  }
  const bytes = await fs.promises.readFile(target).catch((e: unknown) => {
    throw `Failed to read file: ${String(e)}`;
  });
  const hash = sha1(bytes);
  const reason = unreadable(bytes);
  if (reason) {
    return {
      content: "",
      hash,
      mtimeMs: stat.mtimeMs,
      size: bytes.length,
      eol: "lf",
      readOnlyReason: reason,
    };
  }
  const content = bytes.toString("utf8");

  return {
    content,
    hash,
    mtimeMs: stat.mtimeMs,
    size: bytes.length,
    eol: eolOf(content),
  };
}

/** Hash and mtime of what's on disk, or nulls when nothing is. */
export async function currentVersion(
  target: string,
): Promise<{ hash: string | null; mtimeMs: number | null }> {
  try {
    const [bytes, stat] = await Promise.all([
      fs.promises.readFile(target),
      fs.promises.stat(target),
    ]);

    return { hash: sha1(bytes), mtimeMs: stat.mtimeMs };
  } catch {
    return { hash: null, mtimeMs: null };
  }
}

/** Called after every successful write, so watchers don't echo it back. */
type WriteListener = (id: string, absolute: string, hash: string) => void;
const writeListeners = new Set<WriteListener>();

export function onCodeFileWritten(listener: WriteListener): () => void {
  writeListeners.add(listener);

  return () => writeListeners.delete(listener);
}

/** Writes per target run one at a time, so two saves can't both pass the check. */
const writeQueues = new Map<string, Promise<unknown>>();

function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(key) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  const settled = next.catch(() => undefined);
  writeQueues.set(key, settled);
  settled.then(() => {
    if (writeQueues.get(key) === settled) {
      writeQueues.delete(key);
    }
  });

  return next;
}

export async function writeCodeFile(
  id: string,
  relativePath: string,
  content: string,
  baseHash: string | null,
  force = false,
): Promise<CodeWriteResult> {
  const target = await resolveContainedPath(id, relativePath, {
    mustExist: false,
  });

  return serialized(target, async () => {
    const onDisk = await currentVersion(target);
    if (!force && onDisk.hash !== baseHash) {
      return { ok: false, conflict: onDisk };
    }
    const mode = await fs.promises
      .stat(target)
      .then((s) => s.mode & 0o7777)
      .catch(() => null);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.argus-${crypto.randomBytes(6).toString("hex")}.tmp`;
    const bytes = Buffer.from(content, "utf8");
    try {
      await fs.promises.writeFile(temp, bytes);
      if (mode !== null) {
        await fs.promises.chmod(temp, mode);
      }
      await fs.promises.rename(temp, target);
    } catch (e) {
      await fs.promises.rm(temp, { force: true });
      throw `Failed to write file: ${String(e)}`;
    }
    const stat = await fs.promises.stat(target);
    const hash = sha1(bytes);
    for (const listener of writeListeners) {
      try {
        listener(id, target, hash);
      } catch {
        // A listener must not fail the save.
      }
    }

    return { ok: true, hash, mtimeMs: stat.mtimeMs };
  });
}
