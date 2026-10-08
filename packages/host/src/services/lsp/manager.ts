/**
 * Language servers per (session, language): started lazily by the first open
 * document, kept alive by open documents across every connection, stopped
 * after ten idle minutes, capped at six live processes (least recently used
 * goes first), and restarted with backoff when they crash.
 */

import type {
  LspLanguage,
  LspServerSource,
  LspServerState,
  LspStatus,
} from "@argus/remote-protocol";
import type * as P from "vscode-languageserver-protocol";
import { DidOpenTextDocumentNotification } from "vscode-languageserver-protocol/node";
import { emitHostEvent } from "@argus/host/bus";
import { createLogger } from "@argus/host/logger";
import { canonicalSessionRoot } from "../code/paths";
import { capture } from "../telemetry/telemetry";
import { fromUri, toDiagnostic } from "./convert";
import { ServerProcess } from "./server";
import { resolveServer, serverSettings } from "./servers";

const log = createLogger("lsp");

export const MAX_LIVE_SERVERS = 6;
export const CRASH_WINDOW_MS = 5 * 60_000;
export const MAX_RESTARTS = 3;
/** Mutable so tests needn't wait out real backoff. */
export const LSP_TIMING = {
  idleShutdownMs: 10 * 60_000,
  /** Doubles with each crash in the window. */
  restartBaseMs: 1000,
};

export interface OpenDoc {
  relativePath: string;
  absolute: string;
  uri: string;
  languageId: string;
  version: number;
  text: string;
  holders: Set<string>;
}

export interface ServerHandle {
  sessionId: string;
  language: LspLanguage;
  state: LspServerState;
  source?: LspServerSource;
  message?: string;
  docs: Map<string, OpenDoc>;
  proc: ServerProcess | null;
  /** Settles once `proc` has finished its handshake. */
  ready: Promise<ServerProcess | null> | null;
  lastUsed: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  restartTimer: ReturnType<typeof setTimeout> | null;
  crashes: number[];
  /** Raw items from the last completion/code action list, by id. */
  completions: Map<string, unknown>;
  codeActions: Map<string, unknown>;
  /** The last diagnostics per URI, raw — code actions are asked about them. */
  diagnostics: Map<string, P.Diagnostic[]>;
}

const handles = new Map<string, ServerHandle>();

const handleKey = (sessionId: string, language: LspLanguage) =>
  `${sessionId}\0${language}`;

function durationBucket(ms: number): "<1s" | "<5s" | "<30s" | ">=30s" {
  if (ms < 1000) {
    return "<1s";
  }
  if (ms < 5000) {
    return "<5s";
  }

  return ms < 30_000 ? "<30s" : ">=30s";
}

export function lspStatus(sessionId: string): LspStatus {
  const servers = [...handles.values()]
    .filter((h) => h.sessionId === sessionId)
    .sort((a, b) => a.language.localeCompare(b.language))
    .map((h) => ({
      language: h.language,
      state: h.state,
      ...(h.source ? { source: h.source } : {}),
      ...(h.message ? { message: h.message } : {}),
    }));

  return { servers };
}

function setState(
  handle: ServerHandle,
  state: LspServerState,
  message?: string,
): void {
  handle.state = state;
  handle.message = message;
  emitHostEvent(`lsp:status:${handle.sessionId}`, lspStatus(handle.sessionId));
}

function liveCount(): number {
  return [...handles.values()].filter((h) => h.proc).length;
}

function evictForRoom(except: ServerHandle): void {
  while (liveCount() >= MAX_LIVE_SERVERS) {
    const victim = [...handles.values()]
      .filter((h) => h.proc && h !== except)
      .sort((a, b) => a.lastUsed - b.lastUsed)[0];
    if (!victim) {
      return;
    }
    log.info(`evicting ${victim.language} for ${victim.sessionId}`);
    stopProcess(victim, "stopped");
  }
}

function stopProcess(handle: ServerHandle, state: LspServerState): void {
  const proc = handle.proc;
  handle.proc = null;
  handle.ready = null;
  if (proc) {
    proc.stop().catch(() => undefined);
  }
  setState(handle, state);
}

export function sendOpen(proc: ServerProcess, doc: OpenDoc): void {
  proc.notify(DidOpenTextDocumentNotification.type, {
    textDocument: {
      uri: doc.uri,
      languageId: doc.languageId,
      version: doc.version,
      text: doc.text,
    },
  });
}

async function onDiagnostics(
  handle: ServerHandle,
  uri: string,
  version: number | undefined,
  diagnostics: P.Diagnostic[],
): Promise<void> {
  handle.diagnostics.set(uri, diagnostics);
  const relativePath = await fromUri(handle.sessionId, uri);
  if (relativePath === null) {
    return;
  }
  emitHostEvent(`lsp:diagnostics:${handle.sessionId}`, {
    relativePath,
    version: version ?? null,
    diagnostics: diagnostics.map(toDiagnostic),
  });
}

function onCrash(handle: ServerHandle, proc: ServerProcess, detail: string) {
  if (handle.proc !== proc) {
    return;
  }
  handle.proc = null;
  handle.ready = null;
  const now = Date.now();
  handle.crashes = handle.crashes.filter((t) => now - t < CRASH_WINDOW_MS);
  handle.crashes.push(now);
  const gaveUp = handle.crashes.length > MAX_RESTARTS;
  capture("lsp_server_crashed", { language: handle.language, gave_up: gaveUp });
  log.warn(`${handle.language} server crashed (${detail})`);
  if (gaveUp) {
    setState(handle, "failed", detail);

    return;
  }
  if (handle.docs.size === 0) {
    setState(handle, "stopped");

    return;
  }
  setState(handle, "starting", detail);
  const delay = LSP_TIMING.restartBaseMs * 2 ** (handle.crashes.length - 1);
  handle.restartTimer = setTimeout(() => {
    handle.restartTimer = null;
    if (handles.get(handleKey(handle.sessionId, handle.language)) === handle) {
      ensureRunning(handle).catch(() => undefined);
    }
  }, delay);
}

async function start(handle: ServerHandle): Promise<ServerProcess | null> {
  setState(handle, "starting");
  const resolved = await resolveServer(handle.language);
  if ("missing" in resolved) {
    handle.source = undefined;
    setState(handle, "missing", resolved.missing);
    capture("lsp_server_started", {
      language: handle.language,
      source: "none",
      success: false,
      duration_bucket: "<1s",
    });

    return null;
  }
  handle.source = resolved.source;
  evictForRoom(handle);
  const startedAt = Date.now();
  const proc: ServerProcess = new ServerProcess({
    resolved,
    root: canonicalSessionRoot(handle.sessionId),
    settings: serverSettings(handle.language),
    onDiagnostics: (p) => {
      onDiagnostics(handle, p.uri, p.version, p.diagnostics).catch(
        () => undefined,
      );
    },
    onCrash: (detail) => onCrash(handle, proc, detail),
  });
  handle.proc = proc;
  try {
    await proc.initialize();
  } catch (err) {
    capture("lsp_server_started", {
      language: handle.language,
      source: resolved.source,
      success: false,
      duration_bucket: durationBucket(Date.now() - startedAt),
    });
    if (handle.proc === proc) {
      // Counts as a crash: same backoff, same give-up.
      proc.kill();
      onCrash(handle, proc, err instanceof Error ? err.message : String(err));
    }

    return null;
  }
  if (handle.proc !== proc) {
    return null;
  }
  capture("lsp_server_started", {
    language: handle.language,
    source: resolved.source,
    success: true,
    duration_bucket: durationBucket(Date.now() - startedAt),
  });
  for (const doc of handle.docs.values()) {
    sendOpen(proc, doc);
  }
  setState(handle, "ready");

  return proc;
}

/** The handle's server, started if it can be; null when missing or failed. */
export function ensureRunning(
  handle: ServerHandle,
): Promise<ServerProcess | null> {
  handle.lastUsed = Date.now();
  if (handle.state === "failed" || handle.state === "missing") {
    return Promise.resolve(null);
  }
  if (handle.restartTimer) {
    return Promise.resolve(null);
  }
  if (!handle.ready) {
    handle.ready = start(handle);
  }

  return handle.ready;
}

export function getHandle(
  sessionId: string,
  language: LspLanguage,
): ServerHandle {
  const key = handleKey(sessionId, language);
  let handle = handles.get(key);
  if (!handle) {
    handle = {
      sessionId,
      language,
      state: "stopped",
      docs: new Map(),
      proc: null,
      ready: null,
      lastUsed: Date.now(),
      idleTimer: null,
      restartTimer: null,
      crashes: [],
      completions: new Map(),
      codeActions: new Map(),
      diagnostics: new Map(),
    };
    handles.set(key, handle);
  }

  return handle;
}

export function armIdle(handle: ServerHandle): void {
  if (handle.idleTimer) {
    clearTimeout(handle.idleTimer);
    handle.idleTimer = null;
  }
  if (handle.docs.size > 0) {
    return;
  }
  handle.idleTimer = setTimeout(() => {
    handle.idleTimer = null;
    if (handle.docs.size === 0 && handle.proc) {
      stopProcess(handle, "stopped");
    }
  }, LSP_TIMING.idleShutdownMs);
}

/** Forget a failure and try again. */
export function lspRestart(sessionId: string, language: LspLanguage): void {
  const handle = getHandle(sessionId, language);
  if (handle.restartTimer) {
    clearTimeout(handle.restartTimer);
    handle.restartTimer = null;
  }
  handle.crashes = [];
  if (handle.proc) {
    const proc = handle.proc;
    handle.proc = null;
    handle.ready = null;
    proc.stop().catch(() => undefined);
  }
  handle.ready = null;
  setState(handle, "stopped");
  if (handle.docs.size > 0) {
    ensureRunning(handle).catch(() => undefined);
  }
}

function dropHandle(handle: ServerHandle): void {
  if (handle.idleTimer) {
    clearTimeout(handle.idleTimer);
  }
  if (handle.restartTimer) {
    clearTimeout(handle.restartTimer);
  }
  handle.proc?.kill();
  handle.proc = null;
  handle.ready = null;
  handles.delete(handleKey(handle.sessionId, handle.language));
}

/** Kill every server of a session, or every server at all. */
export function stopLanguageServers(sessionId?: string): void {
  for (const handle of [...handles.values()]) {
    if (!sessionId || handle.sessionId === sessionId) {
      dropHandle(handle);
    }
  }
}

/** Ready servers of a session (the watched-files bridge). */
export function readyHandles(sessionId: string): ServerHandle[] {
  return [...handles.values()].filter(
    (h) => h.sessionId === sessionId && h.proc && h.state === "ready",
  );
}

/** Every handle (tests). */
export function allHandles(): ServerHandle[] {
  return [...handles.values()];
}
