/**
 * Open files in the embedded VS Code editor.
 *
 * Resolves relative paths against the selected workspace, switches the
 * center panel to the Editor view so the result is visible, then defers
 * to IEditorService.openEditor — which natively reuses an existing tab
 * for the same file or creates a new one alongside others.
 */

import { getService } from "@codingame/monaco-vscode-api";
import { IEditorService } from "@codingame/monaco-vscode-api/services";
import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { setActiveCenterView } from "../stores/editorStore";
import { getWorkspaceState } from "../stores/workspaceStore";
import {
  getActiveWorktreePath,
  updateWorkspaceFolder,
} from "./vscodeFilesystem";

function getWorkspaceRoot(): string | null {
  // Prefer VS Code's current workspace path (already initialized) but fall
  // back to the selected workspace from the store when the Editor tab has
  // never been opened yet.
  const active = getActiveWorktreePath();
  if (active) {
    return active;
  }
  const { selectedId, workspaces } = getWorkspaceState();
  const ws = workspaces.find((w) => w.id === selectedId);

  return ws?.path ?? null;
}

function resolveAbsolute(pathOrRelative: string): string | null {
  if (pathOrRelative.startsWith("/")) {
    return pathOrRelative;
  }
  const root = getWorkspaceRoot();
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

  // Ensure VS Code has a workspace folder set — required for features like
  // the file explorer and language services to treat the opened file
  // correctly. No-op if already set to this path.
  const root = getWorkspaceRoot();
  if (root) {
    await updateWorkspaceFolder(root);
  }

  // Make the Editor view visible in the center panel so the user can see
  // the tab that's about to open.
  setActiveCenterView("editor");

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
