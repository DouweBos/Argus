/**
 * Append-only log file with size-based rotation.
 *
 * Writes land in `~/.argus/logs/main.log`. When the current file crosses
 * `MAX_BYTES`, it is closed and shifted to `main.log.1`, with any existing
 * rotated files pushed down; files older than `MAX_FILES` are discarded.
 *
 * The legacy `~/.argus/main.log` from before this split is migrated on
 * startup into `logs/main.log` so nothing is lost.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 5;

const baseDir = path.join(os.homedir(), ".argus");
const logDir = path.join(baseDir, "logs");
const currentPath = path.join(logDir, "main.log");
const legacyPath = path.join(baseDir, "main.log");

fs.mkdirSync(logDir, { recursive: true });

// One-shot migration: if an older single-file log exists, move it in.
try {
  if (fs.existsSync(legacyPath) && !fs.existsSync(currentPath)) {
    fs.renameSync(legacyPath, currentPath);
  }
} catch {
  // Best effort — if migration fails we just start fresh.
}

let stream: fs.WriteStream = openStream();
let bytesWritten = initialSize();

function openStream(): fs.WriteStream {
  return fs.createWriteStream(currentPath, { flags: "a" });
}

function initialSize(): number {
  try {
    return fs.statSync(currentPath).size;
  } catch {
    return 0;
  }
}

function rotate(): void {
  stream.end();

  // Drop the oldest, shift everything else down by one.
  const oldest = `${currentPath}.${MAX_FILES}`;
  try {
    if (fs.existsSync(oldest)) {
      fs.rmSync(oldest);
    }
  } catch {
    // Ignore; we'll overwrite it below if the rename succeeds.
  }

  for (let i = MAX_FILES - 1; i >= 1; i--) {
    const src = `${currentPath}.${i}`;
    const dst = `${currentPath}.${i + 1}`;
    try {
      if (fs.existsSync(src)) {
        fs.renameSync(src, dst);
      }
    } catch {
      // Keep going — a missing rotated file is harmless.
    }
  }

  try {
    fs.renameSync(currentPath, `${currentPath}.1`);
  } catch {
    // If rename fails (e.g. file vanished) the next open recreates it.
  }

  stream = openStream();
  bytesWritten = 0;
}

function formatArg(a: unknown): string {
  if (a instanceof Error) {
    return a.stack ?? `${a.name}: ${a.message}`;
  }
  if (typeof a === "string") {
    return a;
  }
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

export function writeLogLine(level: string, args: unknown[]): void {
  const line = `[${new Date().toISOString()}] [${level}] ${args.map(formatArg).join(" ")}\n`;
  if (bytesWritten + line.length > MAX_BYTES) {
    rotate();
  }
  stream.write(line);
  bytesWritten += Buffer.byteLength(line);
}

export function getLogPath(): string {
  return currentPath;
}
