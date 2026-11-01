/**
 * Opening a session file: one navigation, plus where it was opened from for
 * `web_file_viewed`. The source isn't part of the URL, so a file reached any
 * other way (a link, a reload, Back) reads as `link`.
 */

import type { FileViewSource } from "../telemetry/events";
import { appNavigate } from "./router";

let pendingSource: { key: string; source: FileViewSource } | null = null;

function keyOf(sessionId: string, path: string): string {
  return `${sessionId}\u0000${path}`;
}

export function openFile(
  sessionId: string,
  path: string,
  source: FileViewSource,
  line: number | null = null,
): void {
  pendingSource = { key: keyOf(sessionId, path), source };
  appNavigate({ name: "file", sessionId, path, line });
}

/** Where the file now on screen was opened from; read once. */
export function takeFileSource(sessionId: string, path: string): FileViewSource {
  const pending = pendingSource;
  pendingSource = null;

  return pending?.key === keyOf(sessionId, path) ? pending.source : "link";
}
