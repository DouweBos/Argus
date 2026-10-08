/**
 * Language intelligence. The host runs the servers and speaks LSP to them;
 * clients sync their open buffers and ask typed questions. Diagnostics and
 * server state arrive as `lsp:diagnostics:<sessionId>` / `lsp:status:<sessionId>`
 * (subscribe to scope `lsp:<sessionId>`).
 */

import { z } from "zod";
import {
  LspCodeAction,
  LspCompletionItem,
  LspCompletionList,
  LspContentChange,
  LspHover,
  LspLanguage,
  LspLocation,
  LspPosition,
  LspRange,
  LspSignatureHelp,
  LspStatus,
  LspTextEdit,
  LspWorkspaceEdit,
} from "../models/lsp";
import { type CommandSpec, Void } from "./spec";

const Doc = z.object({ id: z.string(), relativePath: z.string() });
const At = Doc.extend({ position: LspPosition });

export const LSP_COMMANDS = {
  /**
   * `languageId` is LSP's (`typescriptreact`, `objective-c`, …). Opening the
   * first document of a language starts its server.
   */
  lsp_did_open: {
    tier: "admin",
    params: Doc.extend({
      languageId: z.string(),
      version: z.number().int(),
      text: z.string(),
    }),
    result: Void,
  },
  lsp_did_change: {
    tier: "admin",
    params: Doc.extend({
      version: z.number().int(),
      changes: z.array(LspContentChange),
    }),
    result: Void,
  },
  lsp_did_close: { tier: "admin", params: Doc, result: Void },
  lsp_completion: {
    tier: "admin",
    params: At.extend({ triggerCharacter: z.string().optional() }),
    result: LspCompletionList,
  },
  lsp_completion_resolve: {
    tier: "admin",
    params: Doc.extend({ resolveId: z.string() }),
    result: LspCompletionItem,
  },
  lsp_hover: { tier: "admin", params: At, result: LspHover.nullable() },
  lsp_definition: { tier: "admin", params: At, result: z.array(LspLocation) },
  lsp_references: {
    tier: "admin",
    params: At.extend({ includeDeclaration: z.boolean().optional() }),
    result: z.array(LspLocation),
  },
  lsp_rename: {
    tier: "admin",
    params: At.extend({ newName: z.string().min(1) }),
    result: LspWorkspaceEdit,
  },
  lsp_format: {
    tier: "admin",
    params: Doc.extend({
      tabSize: z.number().int().positive(),
      insertSpaces: z.boolean(),
      /** Absent formats the whole document. */
      range: LspRange.optional(),
    }),
    result: z.array(LspTextEdit),
  },
  lsp_code_actions: {
    tier: "admin",
    params: Doc.extend({ range: LspRange }),
    result: z.array(LspCodeAction),
  },
  /** Returns the edits to apply; nothing is written by the host. */
  lsp_execute_code_action: {
    tier: "admin",
    params: Doc.extend({ actionId: z.string() }),
    result: LspWorkspaceEdit,
  },
  lsp_signature_help: {
    tier: "admin",
    params: At,
    result: LspSignatureHelp.nullable(),
  },
  lsp_status: {
    tier: "admin",
    params: z.object({ id: z.string() }),
    result: LspStatus,
  },
  /** Clears a `failed`/`missing` state and starts the server again. */
  lsp_restart: {
    tier: "admin",
    params: z.object({ id: z.string(), language: LspLanguage }),
    result: Void,
  },
} as const satisfies Record<string, CommandSpec>;
