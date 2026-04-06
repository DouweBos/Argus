import { create } from "zustand";

/**
 * Simplified editor store for the monaco-vscode-api migration.
 *
 * VS Code manages tabs, models, file content, and the workspace folder
 * internally. The EditorPanel drives workspace switching directly via
 * updateWorkspaceFolder(). This store exists only for any remaining
 * cross-component coordination that isn't covered by VS Code services.
 */
interface EditorState {
  activeWorkspaceId: null | string;
  clearWorkspace: () => void;
  setActiveWorkspace: (workspaceId: string) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  activeWorkspaceId: null,

  setActiveWorkspace: (workspaceId: string) => {
    set({ activeWorkspaceId: workspaceId });
  },

  clearWorkspace: () => {
    set({ activeWorkspaceId: null });
  },
}));
