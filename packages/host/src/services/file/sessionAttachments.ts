/**
 * Files attached to a chat message from another device (the phone), saved
 * inside the session's worktree so its agent can read them without leaving
 * its working directory. Kept out of diffs and commits through `info/exclude`.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { warn } from "@argus/host/logger";
import { appState } from "../../state";
import { excludeFromGit } from "../session/gitExclude";
import { capture } from "../telemetry/telemetry";
import {
  approximateDecodedBytes,
  MAX_BASE64_UPLOAD_BYTES,
  safeName,
  tooLargeMessage,
} from "./uploads";

/** Worktree-relative home of attached files, one random dir per file. */
export const ATTACHMENTS_DIR = ".argus/attachments";

export interface SavedSessionAttachment {
  /** Absolute path on the host. */
  path: string;
  /** The same file relative to the worktree, what the message mentions. */
  relative_path: string;
  name: string;
  size: number;
}

/**
 * Write base64 bytes to `<worktree>/.argus/attachments/<id>/<name>`.
 *
 * @throws string if the session is unknown, the payload exceeds
 *   {@link MAX_BASE64_UPLOAD_BYTES} (one gateway frame), or the write fails.
 */
export async function saveSessionAttachment(
  sessionId: string,
  name: string,
  dataBase64: string,
): Promise<SavedSessionAttachment> {
  const session = appState.sessions.get(sessionId);
  if (!session) {
    throw `Session not found: ${sessionId}`;
  }
  // Measured on the encoded length: decoding a hostile payload to size it is the allocation to avoid.
  if (approximateDecodedBytes(dataBase64) > MAX_BASE64_UPLOAD_BYTES) {
    throw tooLargeMessage(name, MAX_BASE64_UPLOAD_BYTES);
  }
  const bytes = Buffer.from(dataBase64, "base64");
  if (bytes.length > MAX_BASE64_UPLOAD_BYTES) {
    throw tooLargeMessage(name, MAX_BASE64_UPLOAD_BYTES);
  }

  const leaf = safeName(name);
  const relative = path.posix.join(
    ATTACHMENTS_DIR,
    crypto.randomUUID().slice(0, 8),
    leaf,
  );
  const target = path.join(session.path, relative);
  try {
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, bytes);
  } catch (e) {
    throw `Failed to save attachment: ${String(e)}`;
  }
  await excludeFromGit(session.path, `/${ATTACHMENTS_DIR}/`).catch(
    (err: unknown) =>
      warn(
        `[attachments] couldn't keep ${ATTACHMENTS_DIR} out of git: ${String(err)}`,
      ),
  );
  capture("session_attachment_saved", {
    type_bucket: typeBucket(leaf),
    size_bucket: sizeBucket(bytes.length),
  });

  return {
    path: target,
    relative_path: relative,
    name: leaf,
    size: bytes.length,
  };
}

type TypeBucket = "archive" | "code" | "document" | "image" | "other" | "text";

const EXTENSIONS: Record<Exclude<TypeBucket, "other">, string> = {
  document: "pdf doc docx pages key ppt pptx xls xlsx numbers rtf",
  text: "txt md csv tsv log json yaml yml xml html",
  image: "png jpg jpeg gif webp heic svg tiff",
  archive: "zip tar gz tgz 7z rar",
  code: "ts tsx js jsx swift kt java py rb go rs c h m cpp css sh",
};

const TYPE_BY_EXTENSION = new Map<string, TypeBucket>(
  Object.entries(EXTENSIONS).flatMap(([bucket, list]) =>
    list.split(" ").map((ext) => [ext, bucket as TypeBucket] as const),
  ),
);

/** The kind of file, never its name. */
export function typeBucket(name: string): TypeBucket {
  const ext = path.extname(name).slice(1).toLowerCase();

  return TYPE_BY_EXTENSION.get(ext) ?? "other";
}

export function sizeBucket(
  bytes: number,
): "<1MB" | "<5MB" | "<100KB" | ">=5MB" {
  if (bytes < 100 * 1024) {
    return "<100KB";
  }
  if (bytes < 1024 * 1024) {
    return "<1MB";
  }

  return bytes < 5 * 1024 * 1024 ? "<5MB" : ">=5MB";
}
