import { z } from "zod";

/** Why a file opened read-only; its `content` is empty. */
export const CodeReadOnlyReason = z.enum(["binary", "encoding", "too_large"]);
export type CodeReadOnlyReason = z.infer<typeof CodeReadOnlyReason>;

/** A file as the code editor reads it: versioned by the hash of its bytes. */
export const CodeFile = z.object({
  /** Empty when `readOnlyReason` is set. */
  content: z.string(),
  /** SHA-1 hex of the bytes on disk. */
  hash: z.string(),
  mtimeMs: z.number(),
  /** Bytes. */
  size: z.number().int(),
  /** The first line break found; `lf` when there is none. */
  eol: z.enum(["crlf", "lf"]),
  readOnlyReason: CodeReadOnlyReason.optional(),
});
export type CodeFile = z.infer<typeof CodeFile>;

/** What was on disk instead of the expected base. Nulls mean no file. */
export const CodeWriteConflict = z.object({
  hash: z.string().nullable(),
  mtimeMs: z.number().nullable(),
});
export type CodeWriteConflict = z.infer<typeof CodeWriteConflict>;

/**
 * `ok: true` carries the new `hash`/`mtimeMs`; `ok: false` carries `conflict`
 * and wrote nothing. Flat rather than a union so Swift decodes one struct.
 */
export const CodeWriteResult = z.object({
  ok: z.boolean(),
  hash: z.string().optional(),
  mtimeMs: z.number().optional(),
  conflict: CodeWriteConflict.optional(),
});
export type CodeWriteResult = z.infer<typeof CodeWriteResult>;

/** Payload of `code:file-changed:<sessionId>`. A null hash means deleted. */
export const CodeFileChanged = z.object({
  relativePath: z.string(),
  hash: z.string().nullable(),
  mtimeMs: z.number().nullable(),
});
export type CodeFileChanged = z.infer<typeof CodeFileChanged>;

/** One match from a worktree search. */
export const CodeSearchMatch = z.object({
  relativePath: z.string(),
  /** 1-based. */
  line: z.number().int(),
  /** 0-based, UTF-16 units into the line. */
  column: z.number().int(),
  /** UTF-16 units. */
  length: z.number().int(),
  /** A window of the line, capped in length; never ends in a line break. */
  preview: z.string(),
  /** UTF-16 offset in the line where `preview` starts. */
  previewOffset: z.number().int(),
});
export type CodeSearchMatch = z.infer<typeof CodeSearchMatch>;

/**
 * Payload of `code:search:<searchId>`: match batches, then one `done`. Members
 * stay inline so the Swift generator sees the discriminator.
 */
export const CodeSearchEvent = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("matches"),
    searchId: z.string(),
    matches: z.array(CodeSearchMatch),
  }),
  z.object({
    kind: z.literal("done"),
    searchId: z.string(),
    count: z.number().int(),
    /** Stopped at `maxResults` — more matches exist. */
    truncated: z.boolean(),
    cancelled: z.boolean(),
    /** ripgrep's own complaint, e.g. an invalid regex. */
    error: z.string().optional(),
  }),
]);
export type CodeSearchEvent = z.infer<typeof CodeSearchEvent>;

export const CodeSearchQuery = z.object({
  query: z.string().min(1),
  regex: z.boolean(),
  caseSensitive: z.boolean(),
  wholeWord: z.boolean(),
  /** Globs relative to the worktree, e.g. `src/**`, `*.swift`. */
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  /** Defaults to 2000, capped at 20000. */
  maxResults: z.number().int().positive().optional(),
});
export type CodeSearchQuery = z.infer<typeof CodeSearchQuery>;

/** What a symbol is, from the host's definition index or a language server. */
export const CodeSymbolKind = z.enum([
  "class",
  "struct",
  "enum",
  "interface",
  "protocol",
  "extension",
  "function",
  "method",
  "constructor",
  "property",
  "constant",
  "variable",
  "type_alias",
  "enum_member",
  "module",
  "other",
]);
export type CodeSymbolKind = z.infer<typeof CodeSymbolKind>;

/** A definition somewhere in the worktree. */
export const CodeSymbol = z.object({
  name: z.string(),
  kind: CodeSymbolKind,
  /** The enclosing type or module, e.g. `Store` for `Store.load`. */
  container: z.string().optional(),
  relativePath: z.string(),
  /** 1-based. */
  line: z.number().int(),
  /** 0-based, UTF-16 units into the line. */
  column: z.number().int(),
});
export type CodeSymbol = z.infer<typeof CodeSymbol>;

export const CodeSymbolSearchResult = z.object({
  /** Best matches first. */
  symbols: z.array(CodeSymbol),
  /** False while the index is still being built: ask again for the rest. */
  complete: z.boolean(),
});
export type CodeSymbolSearchResult = z.infer<typeof CodeSymbolSearchResult>;
