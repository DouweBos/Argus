/**
 * Symbols from language servers for Open Quickly: workspace-wide by name and
 * per open document. Only servers already running answer — searching never
 * starts one — and locations outside the session are dropped.
 */

import type { CodeSymbol, CodeSymbolKind } from "@argus/remote-protocol";
import type * as P from "vscode-languageserver-protocol";
import {
  DocumentSymbolRequest,
  WorkspaceSymbolRequest,
} from "vscode-languageserver-protocol/node";
import { capture } from "../telemetry/telemetry";
import { fromUri } from "./convert";
import { findDoc } from "./documents";
import { readyHandles, type ServerHandle } from "./manager";

const SYMBOL_TIMEOUT_MS = 3000;
/** Per server; a fuzzy query can match half a workspace. */
const MAX_WORKSPACE_SYMBOLS = 200;

const KINDS: Record<number, CodeSymbolKind> = {
  2: "module",
  3: "module",
  4: "module",
  5: "class",
  6: "method",
  7: "property",
  8: "property",
  9: "constructor",
  10: "enum",
  11: "interface",
  12: "function",
  13: "variable",
  14: "constant",
  20: "property",
  22: "enum_member",
  23: "struct",
  25: "function",
};

export function toSymbolKind(kind: P.SymbolKind): CodeSymbolKind {
  return KINDS[kind] ?? "other";
}

const CALLABLE = new Set<CodeSymbolKind>(["function", "method", "constructor"]);

/** A server's name for a session file; null for anything outside the session. */
async function sessionPath(
  sessionId: string,
  uri: string,
): Promise<string | null> {
  const rel = await fromUri(sessionId, uri);

  return rel && !rel.startsWith("/") ? rel : null;
}

function symbol(
  name: string,
  kind: P.SymbolKind,
  relativePath: string,
  position: P.Position,
  container?: string,
): CodeSymbol {
  return {
    name,
    kind: toSymbolKind(kind),
    ...(container ? { container } : {}),
    relativePath,
    line: position.line + 1,
    column: position.character,
  };
}

/** `textDocument/documentSymbol`'s answer, flattened, without the locals of functions. */
export function flattenDocumentSymbols(
  relativePath: string,
  result: P.DocumentSymbol[] | P.SymbolInformation[] | null,
): CodeSymbol[] {
  const out: CodeSymbol[] = [];
  const walk = (items: P.DocumentSymbol[], parent?: CodeSymbol) => {
    for (const item of items) {
      const entry = symbol(
        item.name,
        item.kind,
        relativePath,
        item.selectionRange.start,
        parent?.name,
      );
      const local =
        parent && CALLABLE.has(parent.kind) && !CALLABLE.has(entry.kind);
      if (!local) {
        out.push(entry);
      }
      if (item.children?.length && !local) {
        walk(item.children, entry);
      }
    }
  };
  for (const item of result ?? []) {
    if ("location" in item) {
      out.push(
        symbol(
          item.name,
          item.kind,
          relativePath,
          item.location.range.start,
          item.containerName || undefined,
        ),
      );
    } else {
      walk([item]);
    }
  }

  return out;
}

async function askServer(
  handle: ServerHandle,
  query: string,
): Promise<CodeSymbol[]> {
  const proc = handle.proc;
  if (!proc?.capabilities.workspaceSymbolProvider) {
    return [];
  }
  let result: (P.SymbolInformation | P.WorkspaceSymbol)[] | null;
  try {
    result = await proc.request<
      (P.SymbolInformation | P.WorkspaceSymbol)[] | null
    >(WorkspaceSymbolRequest.type, { query }, SYMBOL_TIMEOUT_MS);
    capture("lsp_feature_used", {
      feature: "workspace_symbols",
      language: handle.language,
      success: true,
    });
  } catch {
    capture("lsp_feature_used", {
      feature: "workspace_symbols",
      language: handle.language,
      success: false,
    });

    return [];
  }
  const out: CodeSymbol[] = [];
  for (const item of (result ?? []).slice(0, MAX_WORKSPACE_SYMBOLS)) {
    const relativePath = await sessionPath(handle.sessionId, item.location.uri);
    if (relativePath === null) {
      continue;
    }
    const start =
      "range" in item.location
        ? item.location.range.start
        : { line: 0, character: 0 };
    out.push(
      symbol(
        item.name,
        item.kind,
        relativePath,
        start,
        item.containerName || undefined,
      ),
    );
  }

  return out;
}

/** Every ready server of the session, asked in parallel; duplicates across servers dropped. */
export async function lspWorkspaceSymbols(
  sessionId: string,
  query: string,
): Promise<CodeSymbol[]> {
  if (!query.trim()) {
    return [];
  }
  const answers = await Promise.all(
    readyHandles(sessionId).map((h) => askServer(h, query)),
  );
  const seen = new Set<string>();

  return answers.flat().filter((s) => {
    const key = `${s.relativePath}\0${s.line}\0${s.name}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);

    return true;
  });
}

export async function lspDocumentSymbols(
  sessionId: string,
  relativePath: string,
): Promise<CodeSymbol[]> {
  const found = await findDoc(sessionId, relativePath);
  const proc = found?.handle.proc;
  if (
    !found ||
    !proc ||
    found.handle.state !== "ready" ||
    !proc.capabilities.documentSymbolProvider
  ) {
    return [];
  }
  const language = found.handle.language;
  try {
    const result = await proc.request<
      P.DocumentSymbol[] | P.SymbolInformation[] | null
    >(
      DocumentSymbolRequest.type,
      { textDocument: { uri: found.doc.uri } },
      SYMBOL_TIMEOUT_MS,
    );
    capture("lsp_feature_used", {
      feature: "document_symbols",
      language,
      success: true,
    });

    return flattenDocumentSymbols(found.doc.relativePath, result);
  } catch (err) {
    capture("lsp_feature_used", {
      feature: "document_symbols",
      language,
      success: false,
    });
    throw err instanceof Error ? err.message : String(err);
  }
}
