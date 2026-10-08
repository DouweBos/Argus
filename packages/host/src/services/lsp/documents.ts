/**
 * Open documents: the buffers clients sync while a file is open in an editor.
 * Each is held by the connections that opened it and closed — on the server —
 * when the last one lets go or drops.
 */

import type { LspContentChange } from "@argus/remote-protocol";
import {
  DidChangeTextDocumentNotification,
  DidCloseTextDocumentNotification,
  TextDocumentSyncKind,
} from "vscode-languageserver-protocol/node";
import { clientPath } from "../code/paths";
import { resolveContainedPath } from "../file/operations";
import {
  currentConnectionId,
  onConnectionClose,
} from "../remote/connectionScope";
import { applyChanges, toUri } from "./convert";
import {
  allHandles,
  armIdle,
  ensureRunning,
  getHandle,
  type OpenDoc,
  sendOpen,
  type ServerHandle,
} from "./manager";
import { languageForId } from "./servers";

/** A request over local IPC has no connection; it holds until closed. */
const LOCAL_HOLDER = "local";
const hookedConnections = new Set<string>();

function holder(): string {
  return currentConnectionId() ?? LOCAL_HOLDER;
}

function hookConnection(who: string): void {
  if (who === LOCAL_HOLDER || hookedConnections.has(who)) {
    return;
  }
  hookedConnections.add(who);
  onConnectionClose(() => {
    hookedConnections.delete(who);
    for (const handle of allHandles()) {
      for (const doc of [...handle.docs.values()]) {
        if (doc.holders.delete(who) && doc.holders.size === 0) {
          closeDoc(handle, doc);
        }
      }
    }
  });
}

/** Normalised client path and canonical absolute path of a document. */
async function docPaths(
  sessionId: string,
  requested: string,
): Promise<{ relativePath: string; absolute: string }> {
  const absolute = await resolveContainedPath(sessionId, requested, {
    mustExist: false,
  });

  return {
    absolute,
    relativePath: (await clientPath(sessionId, absolute)) ?? requested,
  };
}

/** The open document at `requested`, and the handle that owns it. */
export async function findDoc(
  sessionId: string,
  requested: string,
): Promise<{ handle: ServerHandle; doc: OpenDoc } | null> {
  const { relativePath } = await docPaths(sessionId, requested);
  for (const handle of allHandles()) {
    const doc =
      handle.sessionId === sessionId ? handle.docs.get(relativePath) : null;
    if (doc) {
      return { handle, doc };
    }
  }

  return null;
}

export async function lspDidOpen(
  sessionId: string,
  requested: string,
  languageId: string,
  version: number,
  text: string,
): Promise<void> {
  const language = languageForId(languageId);
  if (!language) {
    return;
  }
  const { relativePath, absolute } = await docPaths(sessionId, requested);
  const handle = getHandle(sessionId, language);
  const who = holder();
  hookConnection(who);
  const existing = handle.docs.get(relativePath);
  if (existing) {
    existing.holders.add(who);
    if (existing.text !== text) {
      await lspDidChange(sessionId, relativePath, version, [{ text }]);
    }

    return;
  }
  const doc: OpenDoc = {
    relativePath,
    absolute,
    uri: toUri(absolute),
    languageId,
    version,
    text,
    holders: new Set([who]),
  };
  handle.docs.set(relativePath, doc);
  armIdle(handle);
  if (handle.proc && handle.state === "ready") {
    sendOpen(handle.proc, doc);
    handle.lastUsed = Date.now();
  } else {
    // A fresh start replays every open document after the handshake.
    ensureRunning(handle).catch(() => undefined);
  }
}

export async function lspDidChange(
  sessionId: string,
  requested: string,
  version: number,
  changes: LspContentChange[],
): Promise<void> {
  const found = await findDoc(sessionId, requested);
  if (!found) {
    return;
  }
  const { handle, doc } = found;
  doc.text = applyChanges(doc.text, changes);
  // Two clients count their own versions; the server needs one rising count.
  doc.version = Math.max(version, doc.version + 1);
  const proc = handle.proc;
  if (!proc || handle.state !== "ready") {
    ensureRunning(handle).catch(() => undefined);

    return;
  }
  handle.lastUsed = Date.now();
  const kind = proc.syncKind;
  if (kind === TextDocumentSyncKind.None) {
    return;
  }
  proc.notify(DidChangeTextDocumentNotification.type, {
    textDocument: { uri: doc.uri, version: doc.version },
    contentChanges:
      kind === TextDocumentSyncKind.Incremental
        ? changes
        : [{ text: doc.text }],
  });
}

function closeDoc(handle: ServerHandle, doc: OpenDoc): void {
  handle.docs.delete(doc.relativePath);
  if (handle.proc && handle.state === "ready") {
    handle.proc.notify(DidCloseTextDocumentNotification.type, {
      textDocument: { uri: doc.uri },
    });
  }
  armIdle(handle);
}

export async function lspDidClose(
  sessionId: string,
  requested: string,
): Promise<void> {
  const found = await findDoc(sessionId, requested);
  if (!found) {
    return;
  }
  const { handle, doc } = found;
  doc.holders.delete(holder());
  if (doc.holders.size === 0) {
    closeDoc(handle, doc);
  }
}
