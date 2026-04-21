import { create } from "zustand";
import { useRouteSessionPanel } from "../lib/routeHooks";
import { appNavigate, getCurrentRoute } from "../lib/router";

export type CenterView = "agents" | "editor" | "git" | "home";

/**
 * Simplified editor store for the monaco-vscode-api migration.
 *
 * VS Code manages tabs, models, file content, and the session folder
 * internally. The EditorPanel drives session switching directly via
 * updateWorkspaceFolder(). The active panel (agents/editor/git) is part of
 * the URL; only the live session id lives here.
 */
interface EditorStoreData {
  activeSessionId: string | null;
}

const editorStore = create<EditorStoreData>(() => ({
  activeSessionId: null,
}));

const useEditorStore = editorStore;

export const setActiveSession = (sessionId: string) => {
  editorStore.setState({ activeSessionId: sessionId });
};

export const clearSession = () => {
  editorStore.setState({ activeSessionId: null });
};

export const setActiveCenterView = (view: CenterView) => {
  const route = getCurrentRoute();
  if (route.view !== "session" || !route.sessionId) {
    return;
  }
  appNavigate({
    view: "session",
    sessionId: route.sessionId,
    panel: view,
  });
};

export const useActiveSessionId = () =>
  useEditorStore((s) => s.activeSessionId);

export const useActiveCenterView = (): CenterView => useRouteSessionPanel();

/** Non-hook accessor — returns the panel for the current route. */
export const getActiveCenterView = (): CenterView =>
  getCurrentRoute().panel;

/** For tests and imperative reads */
export const getEditorState = () => editorStore.getState();
export const setEditorState = editorStore.setState.bind(editorStore);
