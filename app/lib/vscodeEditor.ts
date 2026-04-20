/**
 * Open files in the embedded VS Code editor.
 *
 * Resolves relative paths against the selected session, switches the
 * center panel to the Editor view so the result is visible, then defers
 * to IEditorService.openEditor — which natively reuses an existing tab
 * for the same file or creates a new one alongside others.
 */

import { getService } from "@codingame/monaco-vscode-api";
import {
  IEditorService,
  ILanguageService,
} from "@codingame/monaco-vscode-api/services";
import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { setActiveCenterView } from "../stores/editorStore";
import { getSessionState } from "../stores/sessionStore";
import { createLogger } from "./logger";
import {
  getActiveWorktreePath,
  updateWorkspaceFolder,
} from "./vscodeFilesystem";

const log = createLogger("syntax-highlight-debug");

function getSessionRoot(): string | null {
  // Prefer VS Code's current session path (already initialized) but fall
  // back to the selected session from the store when the Editor tab has
  // never been opened yet.
  const active = getActiveWorktreePath();
  if (active) {
    return active;
  }
  const { selectedId, sessions } = getSessionState();
  const ws = sessions.find((w) => w.id === selectedId);

  return ws?.path ?? null;
}

function resolveAbsolute(pathOrRelative: string): string | null {
  if (pathOrRelative.startsWith("/")) {
    return pathOrRelative;
  }
  const root = getSessionRoot();
  if (!root) {
    return null;
  }

  return `${root.replace(/\/$/, "")}/${pathOrRelative.replace(/^\.\//, "")}`;
}

export async function openFileInEditor(
  pathOrRelative: string,
  line?: number,
): Promise<void> {
  const abs = resolveAbsolute(pathOrRelative);
  if (!abs) {
    return;
  }

  // Ensure VS Code has a session folder set — required for features like
  // the file explorer and language services to treat the opened file
  // correctly. No-op if already set to this path.
  const root = getSessionRoot();
  if (root) {
    await updateWorkspaceFolder(root);
  }

  // Make the Editor view visible in the center panel so the user can see
  // the tab that's about to open.
  setActiveCenterView("editor");

  // [syntax-highlight-debug] Log the language that will be selected for this
  // file. If this returns "plaintext" for a file with a known extension, it
  // means the corresponding language extension didn't load — that's the most
  // common cause of "no syntax highlighting in the editor tab".
  try {
    const languageService = (await getService(ILanguageService)) as unknown as {
      getLanguageIdByMimeType?: (mime: string) => string | null;
      guessLanguageIdByFilepathOrFirstLine?: (uri: URI) => string | null;
    };
    const guessed =
      languageService.guessLanguageIdByFilepathOrFirstLine?.(URI.file(abs)) ??
      null;
    log.info(`opening "${abs}" — guessed language="${guessed}"`);
    if (!guessed || guessed === "plaintext") {
      log.warn(
        `file "${abs}" resolved to "${guessed}". Extension may not be registered, or the language extension didn't load.`,
      );
    }
  } catch (err) {
    log.error("language guess failed for", abs, err);
  }

  const editorService = await getService(IEditorService);
  await editorService.openEditor({
    resource: URI.file(abs),
    options: {
      pinned: true,
      preserveFocus: false,
      selection:
        line && line > 0
          ? { startLineNumber: line, startColumn: 1 }
          : undefined,
    },
  });
}
