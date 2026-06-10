import { create } from "zustand";
import { useRouteSessionId } from "../lib/routeHooks";
import { getCurrentRoute } from "../lib/router";

export type ToolRailId =
  | "changes"
  | "debug"
  | "notifications"
  | "simulator"
  | "terminal";
export type ToolPlacement = "bottom" | "right";

export const TOOL_PLACEMENT: Record<ToolRailId, ToolPlacement> = {
  changes: "right",
  simulator: "right",
  terminal: "bottom",
  debug: "bottom",
  notifications: "bottom",
};

const DEFAULT_RIGHT_TOOL: ToolRailId = "changes";
const DEFAULT_BOTTOM_TOOL: ToolRailId = "terminal";

interface LayoutStoreData {
  /** Active bottom tool per session (null / missing = no tool open). */
  activeBottomToolBySessionId: Record<string, ToolRailId | null>;
  /** Active right tool per session (null / missing = no tool open). */
  activeRightToolBySessionId: Record<string, ToolRailId | null>;
  /** Bottom panel height fraction (0–1). */
  bottomPanelHeight: number;
  /** Last non-null bottom tool per session. */
  lastActiveBottomToolBySessionId: Record<string, ToolRailId>;
  /** Last non-null right tool per session. */
  lastActiveRightToolBySessionId: Record<string, ToolRailId>;
  /** Left sidebar width in pixels. */
  leftPanelWidth: number;
  leftSidebarVisible: boolean;
  /** Tools whose panel content has been mounted at least once. */
  mountedToolIds: Record<ToolRailId, boolean>;
  /** Right tool panel width in pixels. */
  rightPanelWidth: number;
}

const layoutStore = create<LayoutStoreData>(() => ({
  leftSidebarVisible: true,
  leftPanelWidth: 280,
  activeRightToolBySessionId: {},
  activeBottomToolBySessionId: {},
  lastActiveRightToolBySessionId: {},
  lastActiveBottomToolBySessionId: {},
  mountedToolIds: {
    changes: false,
    debug: false,
    notifications: false,
    simulator: false,
    terminal: false,
  },
  rightPanelWidth: 420,
  bottomPanelHeight: 0.3,
}));

const useLayoutStore = layoutStore;

const currentSessionId = (): string | null => getCurrentRoute().sessionId;

const defaultForPlacement = (placement: ToolPlacement): ToolRailId =>
  placement === "right" ? DEFAULT_RIGHT_TOOL : DEFAULT_BOTTOM_TOOL;

const activeKeyForPlacement = (placement: ToolPlacement) =>
  placement === "right"
    ? ("activeRightToolBySessionId" as const)
    : ("activeBottomToolBySessionId" as const);

const lastKeyForPlacement = (placement: ToolPlacement) =>
  placement === "right"
    ? ("lastActiveRightToolBySessionId" as const)
    : ("lastActiveBottomToolBySessionId" as const);

export const toggleLeftSidebar = () =>
  layoutStore.setState((s) => ({ leftSidebarVisible: !s.leftSidebarVisible }));

export const setLeftPanelWidth = (w: number) => {
  layoutStore.setState({ leftPanelWidth: w });
};

const togglePanel = (placement: ToolPlacement) => {
  const sessionId = currentSessionId();
  if (!sessionId) {
    return;
  }
  const activeKey = activeKeyForPlacement(placement);
  const lastKey = lastKeyForPlacement(placement);
  layoutStore.setState((s) => {
    const current = s[activeKey][sessionId] ?? null;
    if (current) {
      return {
        [activeKey]: { ...s[activeKey], [sessionId]: null },
      } as Partial<LayoutStoreData>;
    }
    const id = s[lastKey][sessionId] ?? defaultForPlacement(placement);

    return {
      [activeKey]: { ...s[activeKey], [sessionId]: id },
      [lastKey]: { ...s[lastKey], [sessionId]: id },
      mountedToolIds: { ...s.mountedToolIds, [id]: true },
    } as Partial<LayoutStoreData>;
  });
};

/** Toggle the right tool panel — closes if open, otherwise restores last active right tool. */
export const toggleRightPanel = () => togglePanel("right");

/** Toggle the bottom tool panel — closes if open, otherwise restores last active bottom tool. */
export const toggleBottomPanel = () => togglePanel("bottom");

export const toggleTool = (id: ToolRailId) => {
  const sessionId = currentSessionId();
  if (!sessionId) {
    return;
  }
  const placement = TOOL_PLACEMENT[id];
  const activeKey = activeKeyForPlacement(placement);
  const lastKey = lastKeyForPlacement(placement);
  layoutStore.setState((s) => {
    const current = s[activeKey][sessionId] ?? null;
    if (current === id) {
      return {
        [activeKey]: { ...s[activeKey], [sessionId]: null },
      } as Partial<LayoutStoreData>;
    }

    return {
      [activeKey]: { ...s[activeKey], [sessionId]: id },
      [lastKey]: { ...s[lastKey], [sessionId]: id },
      mountedToolIds: { ...s.mountedToolIds, [id]: true },
    } as Partial<LayoutStoreData>;
  });
};

/**
 * Unconditionally open a tool in its placement panel for a specific session.
 * No-op if already open. The session need not be the currently routed one,
 * so background triggers (MCP `trigger_run`, etc.) can pre-open the tool for
 * the targeted session even when the user is viewing a different one.
 */
export const setActiveToolForSession = (sessionId: string, id: ToolRailId) => {
  const placement = TOOL_PLACEMENT[id];
  const activeKey = activeKeyForPlacement(placement);
  const lastKey = lastKeyForPlacement(placement);
  layoutStore.setState((s) => {
    if (s[activeKey][sessionId] === id) {
      return s;
    }

    return {
      [activeKey]: { ...s[activeKey], [sessionId]: id },
      [lastKey]: { ...s[lastKey], [sessionId]: id },
      mountedToolIds: { ...s.mountedToolIds, [id]: true },
    } as Partial<LayoutStoreData>;
  });
};

/** Unconditionally open a tool in its placement panel (no-op if already open). */
export const setActiveTool = (id: ToolRailId) => {
  const sessionId = currentSessionId();
  if (!sessionId) {
    return;
  }
  const placement = TOOL_PLACEMENT[id];
  const activeKey = activeKeyForPlacement(placement);
  const lastKey = lastKeyForPlacement(placement);
  layoutStore.setState((s) => {
    if (s[activeKey][sessionId] === id) {
      return s;
    }

    return {
      [activeKey]: { ...s[activeKey], [sessionId]: id },
      [lastKey]: { ...s[lastKey], [sessionId]: id },
      mountedToolIds: { ...s.mountedToolIds, [id]: true },
    } as Partial<LayoutStoreData>;
  });
};

export const setRightPanelWidth = (w: number) => {
  layoutStore.setState({ rightPanelWidth: w });
};

export const setBottomPanelHeight = (h: number) => {
  layoutStore.setState({ bottomPanelHeight: h });
};

/** Forget any per-session tool state — call when a session is deleted. */
export const forgetSessionTools = (sessionId: string) => {
  layoutStore.setState((s) => {
    const { [sessionId]: _r1, ...activeRight } = s.activeRightToolBySessionId;
    const { [sessionId]: _r2, ...lastRight } = s.lastActiveRightToolBySessionId;
    const { [sessionId]: _b1, ...activeBottom } = s.activeBottomToolBySessionId;
    const { [sessionId]: _b2, ...lastBottom } =
      s.lastActiveBottomToolBySessionId;

    return {
      activeRightToolBySessionId: activeRight,
      lastActiveRightToolBySessionId: lastRight,
      activeBottomToolBySessionId: activeBottom,
      lastActiveBottomToolBySessionId: lastBottom,
    };
  });
};

export const useLeftSidebarVisible = () =>
  useLayoutStore((s) => s.leftSidebarVisible);

export const useLeftPanelWidth = () => useLayoutStore((s) => s.leftPanelWidth);

export const useActiveToolId = (
  placement: ToolPlacement = "right",
): ToolRailId | null => {
  const sessionId = useRouteSessionId();
  const activeKey = activeKeyForPlacement(placement);

  return useLayoutStore((s) =>
    sessionId ? (s[activeKey][sessionId] ?? null) : null,
  );
};

export const useLastActiveToolId = (
  placement: ToolPlacement = "right",
): ToolRailId => {
  const sessionId = useRouteSessionId();
  const lastKey = lastKeyForPlacement(placement);
  const fallback = defaultForPlacement(placement);

  return useLayoutStore((s) => {
    if (!sessionId) {
      return fallback;
    }

    return s[lastKey][sessionId] ?? fallback;
  });
};

export const useMountedToolIds = () => useLayoutStore((s) => s.mountedToolIds);

export const useRightPanelWidth = () =>
  useLayoutStore((s) => s.rightPanelWidth);

export const useBottomPanelHeight = () =>
  useLayoutStore((s) => s.bottomPanelHeight);

/** For tests */
export const getLayoutState = () => layoutStore.getState();
export const setLayoutState = layoutStore.setState.bind(layoutStore);
