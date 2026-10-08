/** What the host tells servers it can do — only what `convert.ts` can carry. */

import type {
  ClientCapabilities,
  SymbolKind,
} from "vscode-languageserver-protocol";

/** Every `SymbolKind` up to LSP 3.17's last, TypeParameter. */
const SYMBOL_KINDS = {
  valueSet: Array.from({ length: 26 }, (_, i) => (i + 1) as SymbolKind),
};

const CODE_ACTION_KINDS = [
  "",
  "quickfix",
  "refactor",
  "refactor.extract",
  "refactor.inline",
  "refactor.rewrite",
  "source",
  "source.organizeImports",
  "source.fixAll",
];

export const CLIENT_CAPABILITIES: ClientCapabilities = {
  general: { positionEncodings: ["utf-16"] },
  window: { workDoneProgress: true },
  workspace: {
    applyEdit: true,
    configuration: true,
    workspaceFolders: true,
    workspaceEdit: { documentChanges: true },
    didChangeConfiguration: { dynamicRegistration: true },
    didChangeWatchedFiles: { dynamicRegistration: true },
    executeCommand: { dynamicRegistration: true },
    symbol: { symbolKind: SYMBOL_KINDS },
  },
  textDocument: {
    synchronization: { didSave: false, dynamicRegistration: true },
    publishDiagnostics: { versionSupport: true },
    completion: {
      contextSupport: true,
      completionItem: {
        snippetSupport: true,
        insertReplaceSupport: true,
        documentationFormat: ["markdown", "plaintext"],
        resolveSupport: {
          properties: ["documentation", "detail", "additionalTextEdits"],
        },
        preselectSupport: true,
      },
    },
    hover: { contentFormat: ["markdown", "plaintext"] },
    signatureHelp: {
      signatureInformation: {
        documentationFormat: ["markdown", "plaintext"],
        parameterInformation: { labelOffsetSupport: true },
        activeParameterSupport: true,
      },
      contextSupport: true,
    },
    definition: { linkSupport: true },
    references: {},
    documentSymbol: {
      hierarchicalDocumentSymbolSupport: true,
      symbolKind: SYMBOL_KINDS,
    },
    rename: { prepareSupport: false },
    formatting: {},
    rangeFormatting: {},
    codeAction: {
      codeActionLiteralSupport: {
        codeActionKind: { valueSet: CODE_ACTION_KINDS },
      },
      isPreferredSupport: true,
      disabledSupport: true,
      dataSupport: true,
      resolveSupport: { properties: ["edit"] },
    },
  },
};
