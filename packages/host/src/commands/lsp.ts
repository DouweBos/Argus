import { defineTypedCommand } from "../services/command/registry";
import {
  lspDidChange,
  lspDidClose,
  lspDidOpen,
  restartLanguage,
} from "../services/lsp/documents";
import {
  lspCodeActions,
  lspCompletion,
  lspCompletionResolve,
  lspDefinition,
  lspExecuteCodeAction,
  lspFormat,
  lspHover,
  lspReferences,
  lspRename,
  lspSignatureHelp,
} from "../services/lsp/features";
import { lspStatus } from "../services/lsp/manager";
import {
  lspDocumentSymbols,
  lspWorkspaceSymbols,
} from "../services/lsp/symbols";

export function registerLspCommands(): void {
  defineTypedCommand("lsp_did_open", (p) =>
    lspDidOpen(p.id, p.relativePath, p.languageId, p.version, p.text),
  );
  defineTypedCommand("lsp_did_change", (p) =>
    lspDidChange(p.id, p.relativePath, p.version, p.changes),
  );
  defineTypedCommand("lsp_did_close", (p) => lspDidClose(p.id, p.relativePath));
  defineTypedCommand("lsp_completion", (p) =>
    lspCompletion(p.id, p.relativePath, p.position, p.triggerCharacter),
  );
  defineTypedCommand("lsp_completion_resolve", (p) =>
    lspCompletionResolve(p.id, p.relativePath, p.resolveId),
  );
  defineTypedCommand("lsp_hover", (p) =>
    lspHover(p.id, p.relativePath, p.position),
  );
  defineTypedCommand("lsp_definition", (p) =>
    lspDefinition(p.id, p.relativePath, p.position),
  );
  defineTypedCommand("lsp_references", (p) =>
    lspReferences(p.id, p.relativePath, p.position, p.includeDeclaration),
  );
  defineTypedCommand("lsp_rename", (p) =>
    lspRename(p.id, p.relativePath, p.position, p.newName),
  );
  defineTypedCommand("lsp_format", (p) =>
    lspFormat(
      p.id,
      p.relativePath,
      { tabSize: p.tabSize, insertSpaces: p.insertSpaces },
      p.range,
    ),
  );
  defineTypedCommand("lsp_code_actions", (p) =>
    lspCodeActions(p.id, p.relativePath, p.range),
  );
  defineTypedCommand("lsp_execute_code_action", (p) =>
    lspExecuteCodeAction(p.id, p.relativePath, p.actionId),
  );
  defineTypedCommand("lsp_signature_help", (p) =>
    lspSignatureHelp(p.id, p.relativePath, p.position),
  );
  defineTypedCommand("lsp_status", (p) => lspStatus(p.id));
  defineTypedCommand("lsp_restart", (p) => restartLanguage(p.id, p.language));
  defineTypedCommand("lsp_workspace_symbols", (p) =>
    lspWorkspaceSymbols(p.id, p.query),
  );
  defineTypedCommand("lsp_document_symbols", (p) =>
    lspDocumentSymbols(p.id, p.relativePath),
  );
}
