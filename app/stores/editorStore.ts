import { useEffect } from "react";
import { create } from "zustand";
import { useRouteSessionId, useRouteSessionPanel } from "../lib/routeHooks";
import { appNavigate, getCurrentRoute } from "../lib/router";

export type CenterView = "agents" | "editor" | "git" | "home";

/**
 * Simplified editor store for the monaco-vscode-api migration.
 *
 * VS Code manages tabs, models, file content, and the session folder
 * internally. The EditorPanel drives session switching directly via
 * updateWorkspaceFolder(). The active panel (agents/editor/git) is part of
 * the URL; only the live session id lives here.
 *
 * `lastPanelBySessionId` remembers the most recent panel each session was
 * viewed on, so that switching back to a session restores it. In-memory
 * only — cleared on app restart, mirroring `layoutStore`'s tool memory.
 */
interface EditorStoreData {
  activeSessionId: string | null;
  lastPanelBySessionId: Record<string, CenterView>;
}

const editorStore = create<EditorStoreData>(() => ({
  activeSessionId: null,
  lastPanelBySessionId: {},
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
export const getActiveCenterView = (): CenterView => getCurrentRoute().panel;

/** Non-hook accessor — last panel this session was viewed on, if any. */
export const getLastPanelForSession = (sessionId: string): CenterView | null =>
  editorStore.getState().lastPanelBySessionId[sessionId] ?? null;

/** Forget any per-session panel memory — call when a session is deleted. */
export const forgetSessionPanel = (sessionId: string) => {
  editorStore.setState((s) => {
    if (!(sessionId in s.lastPanelBySessionId)) {
      return s;
    }
    const { [sessionId]: _removed, ...rest } = s.lastPanelBySessionId;

    return { lastPanelBySessionId: rest };
  });
};

/**
 * Mount once at the app shell. Records the panel each time the URL points
 * at a session, so that returning to that session restores it.
 */
export const useTrackSessionPanel = (): void => {
  const sessionId = useRouteSessionId();
  const panel = useRouteSessionPanel();

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    editorStore.setState((s) => {
      if (s.lastPanelBySessionId[sessionId] === panel) {
        return s;
      }

      return {
        lastPanelBySessionId: {
          ...s.lastPanelBySessionId,
          [sessionId]: panel,
        },
      };
    });
  }, [sessionId, panel]);
};

/** For tests and imperative reads */
export const getEditorState = () => editorStore.getState();
export const setEditorState = editorStore.setState.bind(editorStore);
