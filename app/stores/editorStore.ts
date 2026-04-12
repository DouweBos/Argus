import { create } from "zustand";

export type CenterView = "agents" | "editor" | "git";

/**
 * Simplified editor store for the monaco-vscode-api migration.
 *
 * VS Code manages tabs, models, file content, and the workspace folder
 * internally. The EditorPanel drives workspace switching directly via
 * updateWorkspaceFolder(). This store exists only for any remaining
 * cross-component coordination that isn't covered by VS Code services.
 */
interface EditorStoreData {
  activeCenterView: CenterView;
  activeWorkspaceId: string | null;
}

const editorStore = create<EditorStoreData>(() => ({
  activeWorkspaceId: null,
  activeCenterView: "agents",
}));

const useEditorStore = editorStore;

export const setActiveWorkspace = (workspaceId: string) => {
  editorStore.setState({ activeWorkspaceId: workspaceId });
};

export const clearWorkspace = () => {
  editorStore.setState({ activeWorkspaceId: null });
};

export const setActiveCenterView = (view: CenterView) => {
  editorStore.setState({ activeCenterView: view });
};

export const useActiveWorkspaceId = () =>
  useEditorStore((s) => s.activeWorkspaceId);

export const useActiveCenterView = () =>
  useEditorStore((s) => s.activeCenterView);

/** For tests and imperative reads */
export const getEditorState = () => editorStore.getState();
export const setEditorState = editorStore.setState.bind(editorStore);
