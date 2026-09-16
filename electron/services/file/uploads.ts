/**
 * Attachment uploads — how a file dropped on the *client* reaches the host.
 *
 * In remote mode the renderer's `webUtils.getPathForFile` yields a path on the
 * laptop's disk, which means nothing to the Mac holding the worktree. The bytes
 * have to travel instead, so the renderer base64-encodes the drop and lands it
 * here; the returned host path is what gets @-mentioned to the agent.
 *
 * Uploads are staged under `ARGUS_HOME`, never inside the worktree — a dropped
 * PDF must not show up as an untracked file in the session's diff.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { argusHomeDir } from "../../lib/argusHome";
import { appState } from "../../state";

/**
 * Cap for a single upload. The gateway's WebSocket accepts 16 MiB frames, and
 * base64 inflates by 4/3, so 8 MiB of file is the largest that still fits with
 * room for the JSON envelope. Enforced on both ends: the renderer to fail fast
 * with a readable message, here because a host can't trust its clients.
 */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** Staged uploads older than this are swept on the next upload. */
const UPLOAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface UploadedAttachment {
  /** Absolute path on the host. */
  path: string;
  name: string;
  size: number;
}

/**
 * Write base64 attachment bytes into this session's staging directory and
 * return the host-side path.
 *
 * @throws string if the session is unknown, the payload exceeds
 *   {@link MAX_UPLOAD_BYTES}, or the write fails.
 */
export async function uploadSessionAttachment(
  id: string,
  name: string,
  dataBase64: string,
): Promise<UploadedAttachment> {
  if (!appState.sessions.has(id)) {
    throw `Session not found: ${id}`;
  }

  // Reject on the encoded length first — decoding a hostile payload just to
  // measure it is the allocation we are trying to avoid.
  if (approximateDecodedBytes(dataBase64) > MAX_UPLOAD_BYTES) {
    throw tooLargeMessage(name);
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(dataBase64, "base64");
  } catch {
    throw `Attachment "${name}" is not valid base64`;
  }
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw tooLargeMessage(name);
  }

  const dir = path.join(uploadsRoot(), id, crypto.randomUUID());
  const target = path.join(dir, safeName(name));

  await sweepExpired(path.join(uploadsRoot(), id));

  try {
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(target, bytes);
  } catch (e) {
    throw `Failed to stage attachment: ${String(e)}`;
  }

  return { path: target, name: path.basename(target), size: bytes.length };
}

/** Human-readable size, so the refusal says what to do about it. */
function tooLargeMessage(name: string): string {
  const cap = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));

  return `"${name}" is larger than the ${cap} MB attachment limit`;
}

function uploadsRoot(): string {
  return path.join(argusHomeDir(), "uploads");
}

/** Base64 encodes 3 bytes per 4 characters, minus any padding. */
function approximateDecodedBytes(data: string): number {
  const padding = /=*$/.exec(data)?.[0].length ?? 0;

  return Math.floor((data.length * 3) / 4) - padding;
}

/**
 * Strip directories and leading dots so a client-supplied name can only ever
 * become a leaf inside the staging directory.
 */
function safeName(name: string): string {
  const base = path
    .basename(name.replace(/\\/g, "/"))
    .replace(/[/\0]/g, "")
    .replace(/^\.+/, "")
    .trim();

  return base.length > 0 ? base.slice(0, 200) : "attachment";
}

/** Best-effort removal of stale staged uploads for a session. */
async function sweepExpired(sessionDir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.promises.readdir(sessionDir);
  } catch {
    return;
  }
  const cutoff = Date.now() - UPLOAD_TTL_MS;
  await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(sessionDir, entry);
      try {
        const stat = await fs.promises.stat(full);
        if (stat.mtimeMs < cutoff) {
          await fs.promises.rm(full, { recursive: true, force: true });
        }
      } catch {
        // A concurrent upload or a permissions hiccup; leave it be.
      }
    }),
  );
}
