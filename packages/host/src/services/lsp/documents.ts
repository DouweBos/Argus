/**
 * Open documents: the buffers clients sync while a file is open in an editor.
 * Each is held by the connections that opened it and closed — on the server —
 * when the last one lets go or drops.
 */

import type { LspContentChange, LspLanguage } from "@argus/remote-protocol";
import {
  DidChangeTextDocumentNotification,
  DidCloseTextDocumentNotification,
  TextDocumentSyncKind,
} from "vscode-languageserver-protocol/node";
import { emitHostEvent } from "@argus/host/bus";
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
  dropHandle,
  ensureRunning,
  getHandle,
  lspRestart,
  lspStatus,
  type OpenDoc,
  sendOpen,
  type ServerHandle,
} from "./manager";
import { routeFor } from "./routing";
import { languageForId } from "./servers";
import { forgetSwiftContext } from "./swift/context";

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
  const who = holder();
  hookConnection(who);
  const existing = allHandles()
    .filter((h) => h.sessionId === sessionId && h.language === language)
    .map((h) => h.docs.get(relativePath))
    .find((d) => d !== undefined);
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
  const handle = getHandle(
    sessionId,
    language,
    routeFor(sessionId, language, absolute),
  );
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

/**
 * Retry a language. Swift files are routed again first: a build server or a
 * package may have appeared since they were opened.
 */
export function restartLanguage(
  sessionId: string,
  language: LspLanguage,
): void {
  if (language !== "swift") {
    lspRestart(sessionId, language);

    return;
  }
  forgetSwiftContext();
  const own = allHandles().filter(
    (h) => h.sessionId === sessionId && h.language === language,
  );
  const docs = own.flatMap((h) => [...h.docs.values()]);
  own.forEach(dropHandle);
  const routed = new Set<ServerHandle>();
  for (const doc of docs) {
    const handle = getHandle(
      sessionId,
      language,
      routeFor(sessionId, language, doc.absolute),
    );
    handle.docs.set(doc.relativePath, doc);
    routed.add(handle);
  }
  emitHostEvent(`lsp:status:${sessionId}`, lspStatus(sessionId));
  for (const handle of routed) {
    ensureRunning(handle).catch(() => undefined);
  }
}
