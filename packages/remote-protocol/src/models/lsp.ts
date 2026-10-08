/**
 * A strict subset of the Language Server Protocol, as the host serves it.
 * Positions are UTF-16 (LSP's default), lines and characters 0-based. Paths
 * are session-relative; a location in another registered project is absolute.
 */

import { z } from "zod";

/** One server per language family; `c` covers C, C++ and Objective-C. */
export const LspLanguage = z.enum([
  "c",
  "css",
  "go",
  "html",
  "json",
  "kotlin",
  "python",
  "ruby",
  "rust",
  "swift",
  "typescript",
  "yaml",
]);
export type LspLanguage = z.infer<typeof LspLanguage>;

export const LspPosition = z.object({
  line: z.number().int().nonnegative(),
  character: z.number().int().nonnegative(),
});
export type LspPosition = z.infer<typeof LspPosition>;

export const LspRange = z.object({ start: LspPosition, end: LspPosition });
export type LspRange = z.infer<typeof LspRange>;

export const LspTextEdit = z.object({ range: LspRange, newText: z.string() });
export type LspTextEdit = z.infer<typeof LspTextEdit>;

/** Edits to one file, applied by the client to its buffer or the disk. */
export const LspFileEdit = z.object({
  relativePath: z.string(),
  edits: z.array(LspTextEdit),
});
export type LspFileEdit = z.infer<typeof LspFileEdit>;

/** No `range` replaces the whole document. */
export const LspContentChange = z.object({
  range: LspRange.optional(),
  text: z.string(),
});
export type LspContentChange = z.infer<typeof LspContentChange>;

export const LspLocation = z.object({
  relativePath: z.string(),
  range: LspRange,
});
export type LspLocation = z.infer<typeof LspLocation>;

export const LspDiagnosticSeverity = z.enum([
  "error",
  "hint",
  "information",
  "warning",
]);
export type LspDiagnosticSeverity = z.infer<typeof LspDiagnosticSeverity>;

export const LspDiagnostic = z.object({
  range: LspRange,
  severity: LspDiagnosticSeverity,
  message: z.string(),
  source: z.string().optional(),
  code: z.string().optional(),
});
export type LspDiagnostic = z.infer<typeof LspDiagnostic>;

/** Payload of `lsp:diagnostics:<sessionId>`. */
export const LspDiagnosticsEvent = z.object({
  relativePath: z.string(),
  /** The document version the server analysed, when it said. */
  version: z.number().int().nullable(),
  diagnostics: z.array(LspDiagnostic),
});
export type LspDiagnosticsEvent = z.infer<typeof LspDiagnosticsEvent>;

export const LspCompletionKind = z.enum([
  "class",
  "color",
  "constant",
  "constructor",
  "enum",
  "enum_member",
  "event",
  "field",
  "file",
  "folder",
  "function",
  "interface",
  "keyword",
  "method",
  "module",
  "operator",
  "property",
  "reference",
  "snippet",
  "struct",
  "text",
  "type_parameter",
  "unit",
  "value",
  "variable",
]);
export type LspCompletionKind = z.infer<typeof LspCompletionKind>;

export const LspCompletionItem = z.object({
  /** Hand back to `lsp_completion_resolve` for documentation and edits. */
  resolveId: z.string(),
  label: z.string(),
  kind: LspCompletionKind.optional(),
  detail: z.string().optional(),
  /** Markdown. */
  documentation: z.string().optional(),
  insertText: z.string().optional(),
  /** `snippet` means `insertText`/`textEdit` use `$1`/`${1:x}` placeholders. */
  insertTextFormat: z.enum(["plain", "snippet"]).optional(),
  textEdit: LspTextEdit.optional(),
  additionalTextEdits: z.array(LspTextEdit).optional(),
  sortText: z.string().optional(),
  filterText: z.string().optional(),
  preselect: z.boolean().optional(),
});
export type LspCompletionItem = z.infer<typeof LspCompletionItem>;

export const LspCompletionList = z.object({
  /** More typing should re-query rather than filter client-side. */
  isIncomplete: z.boolean(),
  items: z.array(LspCompletionItem),
});
export type LspCompletionList = z.infer<typeof LspCompletionList>;

export const LspHover = z.object({
  /** Markdown. */
  contents: z.string(),
  range: LspRange.optional(),
});
export type LspHover = z.infer<typeof LspHover>;

export const LspSignatureParameter = z.object({
  label: z.string(),
  documentation: z.string().optional(),
});
export type LspSignatureParameter = z.infer<typeof LspSignatureParameter>;

export const LspSignature = z.object({
  label: z.string(),
  /** Markdown. */
  documentation: z.string().optional(),
  parameters: z.array(LspSignatureParameter),
  activeParameter: z.number().int().optional(),
});
export type LspSignature = z.infer<typeof LspSignature>;

export const LspSignatureHelp = z.object({
  signatures: z.array(LspSignature),
  activeSignature: z.number().int(),
  activeParameter: z.number().int(),
});
export type LspSignatureHelp = z.infer<typeof LspSignatureHelp>;

export const LspCodeAction = z.object({
  /** Hand back to `lsp_execute_code_action`. */
  actionId: z.string(),
  title: z.string(),
  /** LSP's dotted kind, e.g. `quickfix`, `refactor.extract`. */
  kind: z.string().optional(),
  isPreferred: z.boolean().optional(),
  /** Messages of the diagnostics this action fixes. */
  diagnostics: z.array(z.string()).optional(),
  disabledReason: z.string().optional(),
});
export type LspCodeAction = z.infer<typeof LspCodeAction>;

/** Edits a rename or code action wants made, per file. */
export const LspWorkspaceEdit = z.object({ files: z.array(LspFileEdit) });
export type LspWorkspaceEdit = z.infer<typeof LspWorkspaceEdit>;

export const LspServerState = z.enum([
  "failed",
  "missing",
  "ready",
  "starting",
  "stopped",
]);
export type LspServerState = z.infer<typeof LspServerState>;

/** Where a server binary came from. */
export const LspServerSource = z.enum(["bundled", "path", "toolchain"]);
export type LspServerSource = z.infer<typeof LspServerSource>;

export const LspServerStatus = z.object({
  language: LspLanguage,
  state: LspServerState,
  source: LspServerSource.optional(),
  /** Why it is missing or failed, for the status bar. */
  message: z.string().optional(),
});
export type LspServerStatus = z.infer<typeof LspServerStatus>;

/** Payload of `lsp:status:<sessionId>` and the result of `lsp_status`. */
export const LspStatus = z.object({ servers: z.array(LspServerStatus) });
export type LspStatus = z.infer<typeof LspStatus>;
