/**
 * LSP shapes → the catalog's subset. Server URIs become session-relative paths;
 * anything outside the allowed roots is dropped rather than leaked.
 */

import type {
  LspCompletionItem,
  LspCompletionKind,
  LspDiagnostic,
  LspDiagnosticSeverity,
  LspFileEdit,
  LspLocation,
  LspSignatureHelp,
  LspTextEdit,
} from "@argus/remote-protocol";
import { fileURLToPath, pathToFileURL } from "node:url";
import type * as P from "vscode-languageserver-protocol";
import { clientPath } from "../code/paths";

export function toUri(absolute: string): string {
  return pathToFileURL(absolute).href;
}

/** The client's name for a server URI, or null when it must not see it. */
export async function fromUri(
  sessionId: string,
  uri: string,
): Promise<string | null> {
  if (!uri.startsWith("file:")) {
    return null;
  }
  try {
    return await clientPath(sessionId, fileURLToPath(uri));
  } catch {
    return null;
  }
}

const SEVERITIES: Record<number, LspDiagnosticSeverity> = {
  1: "error",
  2: "warning",
  3: "information",
  4: "hint",
};

export function toDiagnostic(d: P.Diagnostic): LspDiagnostic {
  return {
    range: d.range,
    severity: SEVERITIES[d.severity ?? 1] ?? "error",
    message: toMarkdown(d.message),
    ...(d.source ? { source: d.source } : {}),
    ...(d.code !== undefined && d.code !== null
      ? { code: String(d.code) }
      : {}),
  };
}

type Markup = P.MarkedString | P.MarkedString[] | P.MarkupContent | string;

/** Any of LSP's documentation shapes, as one markdown string. */
export function toMarkdown(value: Markup | null | undefined): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((v) => toMarkdown(v))
      .filter(Boolean)
      .join("\n\n");
  }
  if ("kind" in value) {
    return value.value;
  }

  return `\`\`\`${value.language}\n${value.value}\n\`\`\``;
}

const KINDS: LspCompletionKind[] = [
  "text",
  "method",
  "function",
  "constructor",
  "field",
  "variable",
  "class",
  "interface",
  "module",
  "property",
  "unit",
  "value",
  "enum",
  "keyword",
  "snippet",
  "color",
  "file",
  "reference",
  "folder",
  "enum_member",
  "constant",
  "struct",
  "event",
  "operator",
  "type_parameter",
];

function toTextEdit(
  edit: P.InsertReplaceEdit | P.TextEdit | undefined,
): LspTextEdit | undefined {
  if (!edit) {
    return undefined;
  }
  // Insert, not replace: what VS Code does unless told otherwise.
  const range = "range" in edit ? edit.range : edit.insert;

  return { range, newText: edit.newText };
}

export function toCompletionItem(
  item: P.CompletionItem,
  resolveId: string,
): LspCompletionItem {
  const documentation = toMarkdown(item.documentation);
  const textEdit = toTextEdit(item.textEdit);

  return {
    resolveId,
    label: item.label,
    ...(item.kind ? { kind: KINDS[item.kind - 1] } : {}),
    ...(item.detail ? { detail: item.detail } : {}),
    ...(documentation ? { documentation } : {}),
    ...(item.insertText !== undefined ? { insertText: item.insertText } : {}),
    ...(item.insertTextFormat
      ? { insertTextFormat: item.insertTextFormat === 2 ? "snippet" : "plain" }
      : {}),
    ...(textEdit ? { textEdit } : {}),
    ...(item.additionalTextEdits?.length
      ? { additionalTextEdits: item.additionalTextEdits.map(toPlainEdit) }
      : {}),
    ...(item.sortText ? { sortText: item.sortText } : {}),
    ...(item.filterText ? { filterText: item.filterText } : {}),
    ...(item.preselect ? { preselect: true } : {}),
  };
}

function toPlainEdit(edit: P.TextEdit): LspTextEdit {
  return { range: edit.range, newText: edit.newText };
}

export async function toLocations(
  sessionId: string,
  result: P.Location | P.Location[] | P.LocationLink[] | null | undefined,
): Promise<LspLocation[]> {
  if (!result) {
    return [];
  }
  const list = Array.isArray(result) ? result : [result];
  const out: LspLocation[] = [];
  for (const entry of list) {
    const uri = "targetUri" in entry ? entry.targetUri : entry.uri;
    const range =
      "targetUri" in entry ? entry.targetSelectionRange : entry.range;
    const relativePath = await fromUri(sessionId, uri);
    if (relativePath !== null) {
      out.push({ relativePath, range });
    }
  }

  return out;
}

/** Text edits per file; file creates, renames and deletes are not supported. */
export async function toFileEdits(
  sessionId: string,
  edit: P.WorkspaceEdit | null | undefined,
): Promise<LspFileEdit[]> {
  if (!edit) {
    return [];
  }
  const byUri = new Map<string, LspTextEdit[]>();
  const add = (uri: string, edits: P.TextEdit[]) => {
    const list = byUri.get(uri) ?? [];
    list.push(...edits.map(toPlainEdit));
    byUri.set(uri, list);
  };
  for (const change of edit.documentChanges ?? []) {
    if ("textDocument" in change) {
      add(
        change.textDocument.uri,
        change.edits.filter((e): e is P.TextEdit => "range" in e),
      );
    }
  }
  for (const [uri, edits] of Object.entries(edit.changes ?? {})) {
    add(uri, edits);
  }
  const out: LspFileEdit[] = [];
  for (const [uri, edits] of byUri) {
    const relativePath = await fromUri(sessionId, uri);
    if (relativePath !== null) {
      out.push({ relativePath, edits });
    }
  }

  return out;
}

export function toSignatureHelp(
  help: P.SignatureHelp | null | undefined,
): LspSignatureHelp | null {
  if (!help || help.signatures.length === 0) {
    return null;
  }

  return {
    activeSignature: help.activeSignature ?? 0,
    activeParameter: help.activeParameter ?? 0,
    signatures: help.signatures.map((sig) => {
      const documentation = toMarkdown(sig.documentation);

      return {
        label: sig.label,
        ...(documentation ? { documentation } : {}),
        parameters: (sig.parameters ?? []).map((param) => {
          const label =
            typeof param.label === "string"
              ? param.label
              : sig.label.slice(param.label[0], param.label[1]);
          const doc = toMarkdown(param.documentation);

          return { label, ...(doc ? { documentation: doc } : {}) };
        }),
        ...(typeof sig.activeParameter === "number"
          ? { activeParameter: sig.activeParameter }
          : {}),
      };
    }),
  };
}

/** UTF-16 offset of a position; clamped to the text. */
export function offsetAt(text: string, position: P.Position): number {
  let offset = 0;
  for (let line = 0; line < position.line; line++) {
    const next = text.indexOf("\n", offset);
    if (next < 0) {
      return text.length;
    }
    offset = next + 1;
  }
  const lineEnd = text.indexOf("\n", offset);
  const end = lineEnd < 0 ? text.length : lineEnd;

  return Math.min(offset + position.character, end);
}

/** Apply LSP content changes, in order, to a document's text. */
export function applyChanges(
  text: string,
  changes: { range?: P.Range; text: string }[],
): string {
  let out = text;
  for (const change of changes) {
    if (!change.range) {
      out = change.text;
      continue;
    }
    const start = offsetAt(out, change.range.start);
    const end = Math.max(start, offsetAt(out, change.range.end));
    out = out.slice(0, start) + change.text + out.slice(end);
  }

  return out;
}
