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
import { getSelectedSessionId, getSessionState } from "../stores/sessionStore";
import { createLogger } from "./logger";
import {
  getActiveWorktreePath,
  updateWorkspaceFolder,
} from "./vscodeFilesystem";

const log = createLogger("syntax-highlight-debug");

// EditorPanel mounts lazily — only when the user's route lands on the editor
// view. ⌘-click on a file link from the agents view first switches the route
// (via setActiveCenterView), but openEditor must wait until EditorPanel has
// actually mounted and called attachPart(EDITOR_PART, ...). Without this,
// openEditor races the React commit and silently opens the editor into a
// container that isn't visible — symptom: the editor view shows but the file
// never appears. The race resolves quickly in dev but loses reliably in
// production builds.
let resolveEditorPartReady: (() => void) | null = null;
let editorPartReadyPromise: Promise<void> | null = null;

function ensureEditorPartReadyPromise(): Promise<void> {
  if (!editorPartReadyPromise) {
    editorPartReadyPromise = new Promise<void>((resolve) => {
      resolveEditorPartReady = resolve;
    });
  }

  return editorPartReadyPromise;
}

/** Called by EditorPanel after `attachPart(EDITOR_PART, …)` succeeds. */
export function markEditorPartAttached(): void {
  ensureEditorPartReadyPromise();
  resolveEditorPartReady?.();
  resolveEditorPartReady = null;
}

function whenEditorPartAttached(timeoutMs = 5000): Promise<void> {
  const ready = ensureEditorPartReadyPromise();

  return Promise.race([
    ready,
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

function getSessionRoot(): string | null {
  // Prefer VS Code's current session path (already initialized) but fall
  // back to the selected session from the store when the Editor tab has
  // never been opened yet.
  const active = getActiveWorktreePath();
  if (active) {
    return active;
  }
  const selectedId = getSelectedSessionId();
  const { sessions } = getSessionState();
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

  // Wait for EditorPanel to mount and attach EDITOR_PART. Calling openEditor
  // before that races the React commit and the file never becomes visible
  // (loses reliably in production builds).
  await whenEditorPartAttached();

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
