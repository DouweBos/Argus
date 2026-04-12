import { create } from "zustand";

export type ToolId = "changes" | "simulator" | "terminal";

interface LayoutStoreData {
  /** Right-side tool rail */
  activeToolId: ToolId | null;
  /** Last non-null tool so header stays correct during close animation */
  lastActiveToolId: ToolId;
  /** Panel width fractions (0–1), shared between TitleBar and ResizablePanel */
  leftPanelWidth: number;
  leftSidebarVisible: boolean;
  /** Tools whose panel content has been mounted at least once (lazy mount; stays true). */
  mountedToolIds: Record<ToolId, boolean>;
  toolPanelWidth: number;
}

const layoutStore = create<LayoutStoreData>(() => ({
  leftSidebarVisible: true,
  leftPanelWidth: 0.18,
  activeToolId: null,
  lastActiveToolId: "terminal",
  mountedToolIds: {
    changes: false,
    simulator: false,
    terminal: false,
  },
  toolPanelWidth: 0.3,
}));

const useLayoutStore = layoutStore;

export const toggleLeftSidebar = () =>
  layoutStore.setState((s) => ({ leftSidebarVisible: !s.leftSidebarVisible }));

export const setLeftPanelWidth = (w: number) => {
  layoutStore.setState({ leftPanelWidth: w });
};

export const toggleTool = (id: ToolId) =>
  layoutStore.setState((s) => {
    if (s.activeToolId === id) {
      return { activeToolId: null };
    }

    return {
      activeToolId: id,
      lastActiveToolId: id,
      mountedToolIds: { ...s.mountedToolIds, [id]: true },
    };
  });

export const setToolPanelWidth = (w: number) => {
  layoutStore.setState({ toolPanelWidth: w });
};

export const useLeftSidebarVisible = () =>
  useLayoutStore((s) => s.leftSidebarVisible);

export const useLeftPanelWidth = () => useLayoutStore((s) => s.leftPanelWidth);

export const useActiveToolId = () => useLayoutStore((s) => s.activeToolId);

export const useLastActiveToolId = () =>
  useLayoutStore((s) => s.lastActiveToolId);

export const useMountedToolIds = () => useLayoutStore((s) => s.mountedToolIds);

export const useToolPanelWidth = () => useLayoutStore((s) => s.toolPanelWidth);

/** For tests */
export const getLayoutState = () => layoutStore.getState();
export const setLayoutState = layoutStore.setState.bind(layoutStore);
