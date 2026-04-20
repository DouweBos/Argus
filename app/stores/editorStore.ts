import { create } from "zustand";
import { pushRoute } from "../lib/router";
import { getSessionState } from "./sessionStore";

export type CenterView = "agents" | "editor" | "git" | "home";

/**
 * Simplified editor store for the monaco-vscode-api migration.
 *
 * VS Code manages tabs, models, file content, and the session folder
 * internally. The EditorPanel drives session switching directly via
 * updateWorkspaceFolder(). This store exists only for any remaining
 * cross-component coordination that isn't covered by VS Code services.
 */
interface EditorStoreData {
  activeCenterView: CenterView;
  activeSessionId: string | null;
}

const editorStore = create<EditorStoreData>(() => ({
  activeSessionId: null,
  activeCenterView: "agents",
}));

const useEditorStore = editorStore;

export const setActiveSession = (sessionId: string) => {
  editorStore.setState({ activeSessionId: sessionId });
};

export const clearSession = () => {
  editorStore.setState({ activeSessionId: null });
};

export const setActiveCenterView = (view: CenterView) => {
  editorStore.setState({ activeCenterView: view });
  const { selectedId } = getSessionState();
  if (selectedId) {
    pushRoute({ view: "session", sessionId: selectedId, panel: view });
  }
};

export const useActiveSessionId = () =>
  useEditorStore((s) => s.activeSessionId);

export const useActiveCenterView = () =>
  useEditorStore((s) => s.activeCenterView);

/** For tests and imperative reads */
export const getEditorState = () => editorStore.getState();
export const setEditorState = editorStore.setState.bind(editorStore);
