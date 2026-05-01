import { useEffect } from "react";
import { create } from "zustand";
import { useRouteSessionId, useRouteSessionPanel } from "../lib/routeHooks";
import {
  appNavigate,
  getCurrentRoute,
  navigateToPath,
  type GitSubView,
} from "../lib/router";

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

/**
 * Navigate to a sub-view within the git panel (Phase 6 P1). No-op when
 * outside a session route — callers should ensure they're already on
 * `/sessions/:id/git`.
 */
export const setGitView = (gitView: GitSubView): void => {
  const route = getCurrentRoute();
  if (route.view !== "session" || !route.sessionId) {
    return;
  }
  appNavigate({
    view: "session",
    sessionId: route.sessionId,
    panel: "git",
    gitView,
  });
};

/**
 * Navigate to a ref-scoped sub-view (`branches/:name` or `tags/:name`).
 * Used by the git sidebar to give each branch/tag its own URL so the
 * sidebar's selection state is purely a route-equality check.
 */
export const setGitRef = (kind: "branches" | "tags", name: string): void => {
  const route = getCurrentRoute();
  if (route.view !== "session" || !route.sessionId) {
    return;
  }
  appNavigate({
    view: "session",
    sessionId: route.sessionId,
    panel: "git",
    gitView: kind,
    gitRefName: name,
  });
};

/**
 * Navigate to the compare view for two refs. Query params `left` and `right`
 * encode the two branch names so they survive page reload.
 *
 * Results in: /sessions/:id/git/compare?left=...&right=...
 */
export const setGitCompareView = (left: string, right: string): void => {
  const route = getCurrentRoute();
  if (route.view !== "session" || !route.sessionId) {
    return;
  }
  const params = new URLSearchParams({ left, right }).toString();
  const path = `/sessions/${route.sessionId}/git/compare?${params}`;
  navigateToPath(path);
};

/**
 * Navigate to the interactive rebase view for a given upstream ref.
 * Query param `from` encodes the upstream boundary so it survives page reload.
 *
 * Results in: /sessions/:id/git/interactive-rebase?from=<ref>
 */
export const setGitInteractiveRebaseView = (fromRef: string): void => {
  const route = getCurrentRoute();
  if (route.view !== "session" || !route.sessionId) {
    return;
  }
  const params = new URLSearchParams({ from: fromRef }).toString();
  const navPath = `/sessions/${route.sessionId}/git/interactive-rebase?${params}`;
  navigateToPath(navPath);
};

/**
 * Navigate to the blame view for a file, optionally at a specific ref.
 * Query params `path` and `ref` encode the file path and optional git ref
 * so they survive page reload.
 *
 * Results in: /sessions/:id/git/blame?path=...&ref=...
 */
export const setGitBlameView = (filePath: string, ref?: string): void => {
  const route = getCurrentRoute();
  if (route.view !== "session" || !route.sessionId) {
    return;
  }
  const params = new URLSearchParams({ path: filePath });
  if (ref) {
    params.set("ref", ref);
  }
  const navPath = `/sessions/${route.sessionId}/git/blame?${params.toString()}`;
  navigateToPath(navPath);
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
