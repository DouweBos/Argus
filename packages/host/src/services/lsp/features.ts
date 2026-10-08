/**
 * The typed questions a client asks about an open document, answered by its
 * language's server and translated into the catalog's LSP subset. A server
 * that is missing, failed or still crashing answers with nothing rather than
 * an error — the status event already says why.
 */

import type { ServerProcess } from "./server";
import type {
  LspCodeAction,
  LspCompletionItem,
  LspCompletionList,
  LspHover,
  LspLocation,
  LspPosition,
  LspRange,
  LspSignatureHelp,
  LspTextEdit,
  LspWorkspaceEdit,
} from "@argus/remote-protocol";
import type * as P from "vscode-languageserver-protocol";
import {
  CodeActionRequest,
  CodeActionResolveRequest,
  CompletionRequest,
  CompletionResolveRequest,
  DefinitionRequest,
  DocumentFormattingRequest,
  DocumentRangeFormattingRequest,
  ExecuteCommandRequest,
  HoverRequest,
  ReferencesRequest,
  RenameRequest,
  SignatureHelpRequest,
} from "vscode-languageserver-protocol/node";
import { capture } from "../telemetry/telemetry";
import {
  toCompletionItem,
  toFileEdits,
  toLocations,
  toMarkdown,
  toSignatureHelp,
} from "./convert";
import { findDoc } from "./documents";
import { ensureRunning, type OpenDoc, type ServerHandle } from "./manager";

type Feature =
  | "code_action"
  | "definition"
  | "format"
  | "hover"
  | "references"
  | "rename"
  | "signature_help";

/** Ids for completion items and code actions a client hands back later. */
let nextId = 0;

interface Target {
  handle: ServerHandle;
  doc: OpenDoc;
  proc: ServerProcess;
}

async function target(
  id: string,
  relativePath: string,
): Promise<Target | null> {
  const found = await findDoc(id, relativePath);
  if (!found) {
    return null;
  }
  const proc = await ensureRunning(found.handle);

  return proc ? { ...found, proc } : null;
}

/** Run a feature, recording whether it worked; `empty` when it can't run. */
async function run<T>(
  feature: Feature | null,
  id: string,
  relativePath: string,
  empty: T,
  fn: (t: Target) => Promise<T>,
): Promise<T> {
  const t = await target(id, relativePath);
  if (!t) {
    return empty;
  }
  try {
    const result = await fn(t);
    if (feature) {
      capture("lsp_feature_used", {
        feature,
        language: t.handle.language,
        success: true,
      });
    }

    return result;
  } catch (err) {
    if (feature) {
      capture("lsp_feature_used", {
        feature,
        language: t.handle.language,
        success: false,
      });
    }
    throw err instanceof Error ? err.message : String(err);
  }
}

const before = (a: LspPosition, b: LspPosition) =>
  a.line < b.line || (a.line === b.line && a.character < b.character);

function overlaps(a: LspRange, b: LspRange): boolean {
  return !before(a.end, b.start) && !before(b.end, a.start);
}

const at = (doc: OpenDoc, position: LspPosition) => ({
  textDocument: { uri: doc.uri },
  position,
});

export function lspCompletion(
  id: string,
  relativePath: string,
  position: LspPosition,
  triggerCharacter?: string,
): Promise<LspCompletionList> {
  return run(
    null,
    id,
    relativePath,
    { isIncomplete: false, items: [] },
    async ({ handle, doc, proc }) => {
      const result = await proc.request<
        P.CompletionItem[] | P.CompletionList | null
      >(CompletionRequest.type, {
        ...at(doc, position),
        context: triggerCharacter
          ? { triggerKind: 2, triggerCharacter }
          : { triggerKind: 1 },
      });
      const list = Array.isArray(result)
        ? { isIncomplete: false, items: result }
        : (result ?? { isIncomplete: false, items: [] });
      handle.completions.clear();
      const items = list.items.map((item) => {
        const resolveId = String(++nextId);
        handle.completions.set(resolveId, item);

        return toCompletionItem(item, resolveId);
      });

      return { isIncomplete: list.isIncomplete, items };
    },
  );
}

export async function lspCompletionResolve(
  id: string,
  relativePath: string,
  resolveId: string,
): Promise<LspCompletionItem> {
  const t = await target(id, relativePath);
  const raw = t?.handle.completions.get(resolveId) as
    | P.CompletionItem
    | undefined;
  if (!t || !raw) {
    throw "Completion item is no longer available";
  }
  const provider = t.proc.capabilities.completionProvider;
  if (!provider?.resolveProvider) {
    return toCompletionItem(raw, resolveId);
  }
  const resolved = await t.proc.request<P.CompletionItem>(
    CompletionResolveRequest.type,
    raw,
  );

  return toCompletionItem(resolved ?? raw, resolveId);
}

export function lspHover(
  id: string,
  relativePath: string,
  position: LspPosition,
): Promise<LspHover | null> {
  return run("hover", id, relativePath, null, async ({ doc, proc }) => {
    const hover = await proc.request<P.Hover | null>(
      HoverRequest.type,
      at(doc, position),
    );
    const contents = toMarkdown(hover?.contents);
    if (!hover || !contents) {
      return null;
    }

    return { contents, ...(hover.range ? { range: hover.range } : {}) };
  });
}

export function lspDefinition(
  id: string,
  relativePath: string,
  position: LspPosition,
): Promise<LspLocation[]> {
  return run("definition", id, relativePath, [], async ({ doc, proc }) =>
    toLocations(
      id,
      await proc.request<P.Location | P.Location[] | P.LocationLink[] | null>(
        DefinitionRequest.type,
        at(doc, position),
      ),
    ),
  );
}

export function lspReferences(
  id: string,
  relativePath: string,
  position: LspPosition,
  includeDeclaration = true,
): Promise<LspLocation[]> {
  return run("references", id, relativePath, [], async ({ doc, proc }) =>
    toLocations(
      id,
      await proc.request<P.Location[] | null>(ReferencesRequest.type, {
        ...at(doc, position),
        context: { includeDeclaration },
      }),
    ),
  );
}

export function lspRename(
  id: string,
  relativePath: string,
  position: LspPosition,
  newName: string,
): Promise<LspWorkspaceEdit> {
  return run(
    "rename",
    id,
    relativePath,
    { files: [] },
    async ({ doc, proc }) => ({
      files: await toFileEdits(
        id,
        await proc.request<P.WorkspaceEdit | null>(RenameRequest.type, {
          ...at(doc, position),
          newName,
        }),
      ),
    }),
  );
}

export function lspFormat(
  id: string,
  relativePath: string,
  options: { tabSize: number; insertSpaces: boolean },
  range?: LspRange,
): Promise<LspTextEdit[]> {
  return run("format", id, relativePath, [], async ({ doc, proc }) => {
    const textDocument = { uri: doc.uri };
    const edits = range
      ? await proc.request<P.TextEdit[] | null>(
          DocumentRangeFormattingRequest.type,
          { textDocument, range, options },
        )
      : await proc.request<P.TextEdit[] | null>(
          DocumentFormattingRequest.type,
          { textDocument, options },
        );

    return (edits ?? []).map((e) => ({ range: e.range, newText: e.newText }));
  });
}

export function lspCodeActions(
  id: string,
  relativePath: string,
  range: LspRange,
): Promise<LspCodeAction[]> {
  return run("code_action", id, relativePath, [], async (t) => {
    // Quick fixes are offered for the diagnostics the server reported here.
    const diagnostics = (t.handle.diagnostics.get(t.doc.uri) ?? []).filter(
      (d) => overlaps(d.range, range),
    );
    const result = await t.proc.request<(P.CodeAction | P.Command)[] | null>(
      CodeActionRequest.type,
      { textDocument: { uri: t.doc.uri }, range, context: { diagnostics } },
    );
    t.handle.codeActions.clear();

    return (result ?? []).map((action) => {
      const actionId = String(++nextId);
      t.handle.codeActions.set(actionId, action);
      if (!("kind" in action) && typeof action.command === "string") {
        return { actionId, title: action.title };
      }
      const a = action as P.CodeAction;

      return {
        actionId,
        title: a.title,
        ...(a.kind ? { kind: a.kind } : {}),
        ...(a.isPreferred ? { isPreferred: true } : {}),
        ...(a.diagnostics?.length
          ? { diagnostics: a.diagnostics.map((d) => toMarkdown(d.message)) }
          : {}),
        ...(a.disabled ? { disabledReason: a.disabled.reason } : {}),
      };
    });
  });
}

/** The edits an action amounts to, including any it applies through a command. */
export function lspExecuteCodeAction(
  id: string,
  relativePath: string,
  actionId: string,
): Promise<LspWorkspaceEdit> {
  return run("code_action", id, relativePath, { files: [] }, async (t) => {
    let action = t.handle.codeActions.get(actionId) as
      | P.CodeAction
      | P.Command
      | undefined;
    if (!action) {
      throw "Code action is no longer available";
    }
    const edits: P.WorkspaceEdit[] = [];
    let command: P.Command | undefined;
    if (!("kind" in action) && typeof action.command === "string") {
      command = action as P.Command;
    } else {
      const provider = t.proc.capabilities.codeActionProvider;
      const canResolve =
        typeof provider === "object" && provider.resolveProvider === true;
      if (!(action as P.CodeAction).edit && canResolve) {
        action = await t.proc.request<P.CodeAction>(
          CodeActionResolveRequest.type,
          action,
        );
      }
      const a = action as P.CodeAction;
      if (a.edit) {
        edits.push(a.edit);
      }
      command = a.command;
    }
    if (command) {
      const execute = command;
      edits.push(
        ...(await t.proc.collectAppliedEdits(() =>
          t.proc.request(ExecuteCommandRequest.type, {
            command: execute.command,
            arguments: execute.arguments,
          }),
        )),
      );
    }
    const files = [];
    for (const edit of edits) {
      files.push(...(await toFileEdits(id, edit)));
    }

    return { files };
  });
}

export function lspSignatureHelp(
  id: string,
  relativePath: string,
  position: LspPosition,
): Promise<LspSignatureHelp | null> {
  return run("signature_help", id, relativePath, null, async ({ doc, proc }) =>
    toSignatureHelp(
      await proc.request<P.SignatureHelp | null>(
        SignatureHelpRequest.type,
        at(doc, position),
      ),
    ),
  );
}
