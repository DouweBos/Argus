/**
 * Linear's uploads (screenshots, screen recordings) need the signed-in user's
 * credential, so no player or <img> can load them directly. The host fetches
 * each one once into a cache under $ARGUS_HOME and hands back the file.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { argusHomeDir } from "../../../lib/argusHome";

/** Screen recordings run large; anything past this isn't worth caching. */
const MAX_BYTES = 500 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

export function linearMediaDir(): string {
  return path.join(argusHomeDir(), "cache", "linear-media");
}

export function isLinearUpload(url: string): boolean {
  try {
    return new URL(url).hostname === "uploads.linear.app";
  } catch {
    return false;
  }
}

export interface LinearMedia {
  path: string;
  mimeType: string;
}

/** Cached path for the URL, downloading it first when needed. */
export async function cacheLinearMedia(
  url: string,
  authorization: string,
): Promise<LinearMedia> {
  const dir = linearMediaDir();
  const stem = createHash("sha256").update(url).digest("hex").slice(0, 32);
  await fs.promises.mkdir(dir, { recursive: true });
  const existing = (await fs.promises.readdir(dir)).find((f) =>
    f.startsWith(`${stem}.`),
  );
  if (existing) {
    const ext = existing.split(".").pop() ?? "";
    const mimeType =
      Object.entries(EXTENSIONS).find(([, e]) => e === ext)?.[0] ??
      "application/octet-stream";

    return { path: path.join(dir, existing), mimeType };
  }

  const res = await fetch(url, {
    headers: { authorization },
    signal: AbortSignal.timeout(5 * 60 * 1000),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Linear didn't send the file (HTTP ${res.status}).`);
  }
  const mimeType = res.headers.get("content-type")?.split(";")[0] ?? "";
  const ext = EXTENSIONS[mimeType];
  if (!ext) {
    throw new Error(`Argus can't show ${mimeType || "that kind of file"}.`);
  }
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) {
    throw new Error("That file is too large to show here.");
  }
  // Written under a temporary name so a half-finished download is never served.
  const target = path.join(dir, `${stem}.${ext}`);
  const partial = `${target}.part`;
  await pipeline(
    Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
    fs.createWriteStream(partial),
  );
  await fs.promises.rename(partial, target);

  return { path: target, mimeType };
}
