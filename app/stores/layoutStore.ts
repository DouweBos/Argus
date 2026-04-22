import { create } from "zustand";
import { useRouteSessionId } from "../lib/routeHooks";
import { getCurrentRoute } from "../lib/router";

export type ToolId = "changes" | "simulator" | "terminal";

interface LayoutStoreData {
  /** Active tool per session (null / missing = no tool open). */
  activeToolBySessionId: Record<string, ToolId | null>;
  /** Last non-null tool per session, for close animation header and restore. */
  lastActiveToolBySessionId: Record<string, ToolId>;
  /** Panel width fractions (0–1), shared between TitleBar and ResizablePanel */
  leftPanelWidth: number;
  leftSidebarVisible: boolean;
  /** Tools whose panel content has been mounted at least once (lazy mount; stays true). */
  mountedToolIds: Record<ToolId, boolean>;
  toolPanelWidth: number;
}

const DEFAULT_TOOL: ToolId = "terminal";

const layoutStore = create<LayoutStoreData>(() => ({
  leftSidebarVisible: true,
  leftPanelWidth: 0.18,
  activeToolBySessionId: {},
  lastActiveToolBySessionId: {},
  mountedToolIds: {
    changes: false,
    simulator: false,
    terminal: false,
  },
  toolPanelWidth: 0.3,
}));

const useLayoutStore = layoutStore;

const currentSessionId = (): string | null => getCurrentRoute().sessionId;

export const toggleLeftSidebar = () =>
  layoutStore.setState((s) => ({ leftSidebarVisible: !s.leftSidebarVisible }));

export const setLeftPanelWidth = (w: number) => {
  layoutStore.setState({ leftPanelWidth: w });
};

/** Toggle the right tool panel — closes if open, otherwise restores the last active tool for this session. */
export const toggleRightPanel = () => {
  const sessionId = currentSessionId();
  if (!sessionId) {
    return;
  }
  layoutStore.setState((s) => {
    const current = s.activeToolBySessionId[sessionId] ?? null;
    if (current) {
      return {
        activeToolBySessionId: {
          ...s.activeToolBySessionId,
          [sessionId]: null,
        },
      };
    }
    const id = s.lastActiveToolBySessionId[sessionId] ?? DEFAULT_TOOL;

    return {
      activeToolBySessionId: {
        ...s.activeToolBySessionId,
        [sessionId]: id,
      },
      lastActiveToolBySessionId: {
        ...s.lastActiveToolBySessionId,
        [sessionId]: id,
      },
      mountedToolIds: { ...s.mountedToolIds, [id]: true },
    };
  });
};

export const toggleTool = (id: ToolId) => {
  const sessionId = currentSessionId();
  if (!sessionId) {
    return;
  }
  layoutStore.setState((s) => {
    const current = s.activeToolBySessionId[sessionId] ?? null;
    if (current === id) {
      return {
        activeToolBySessionId: {
          ...s.activeToolBySessionId,
          [sessionId]: null,
        },
      };
    }

    return {
      activeToolBySessionId: {
        ...s.activeToolBySessionId,
        [sessionId]: id,
      },
      lastActiveToolBySessionId: {
        ...s.lastActiveToolBySessionId,
        [sessionId]: id,
      },
      mountedToolIds: { ...s.mountedToolIds, [id]: true },
    };
  });
};

/** Unconditionally open a tool in the right panel (no-op if already open). */
export const setActiveTool = (id: ToolId) => {
  const sessionId = currentSessionId();
  if (!sessionId) {
    return;
  }
  layoutStore.setState((s) => {
    if (s.activeToolBySessionId[sessionId] === id) {
      return s;
    }

    return {
      activeToolBySessionId: {
        ...s.activeToolBySessionId,
        [sessionId]: id,
      },
      lastActiveToolBySessionId: {
        ...s.lastActiveToolBySessionId,
        [sessionId]: id,
      },
      mountedToolIds: { ...s.mountedToolIds, [id]: true },
    };
  });
};

export const setToolPanelWidth = (w: number) => {
  layoutStore.setState({ toolPanelWidth: w });
};

/** Forget any per-session tool state — call when a session is deleted. */
export const forgetSessionTools = (sessionId: string) => {
  layoutStore.setState((s) => {
    const { [sessionId]: _a, ...activeRest } = s.activeToolBySessionId;
    const { [sessionId]: _b, ...lastRest } = s.lastActiveToolBySessionId;

    return {
      activeToolBySessionId: activeRest,
      lastActiveToolBySessionId: lastRest,
    };
  });
};

export const useLeftSidebarVisible = () =>
  useLayoutStore((s) => s.leftSidebarVisible);

export const useLeftPanelWidth = () => useLayoutStore((s) => s.leftPanelWidth);

export const useActiveToolId = (): ToolId | null => {
  const sessionId = useRouteSessionId();

  return useLayoutStore((s) =>
    sessionId ? (s.activeToolBySessionId[sessionId] ?? null) : null,
  );
};

export const useLastActiveToolId = (): ToolId => {
  const sessionId = useRouteSessionId();

  return useLayoutStore((s) => {
    if (!sessionId) {
      return DEFAULT_TOOL;
    }

    return s.lastActiveToolBySessionId[sessionId] ?? DEFAULT_TOOL;
  });
};

export const useMountedToolIds = () => useLayoutStore((s) => s.mountedToolIds);

export const useToolPanelWidth = () => useLayoutStore((s) => s.toolPanelWidth);

/** For tests */
export const getLayoutState = () => layoutStore.getState();
export const setLayoutState = layoutStore.setState.bind(layoutStore);
