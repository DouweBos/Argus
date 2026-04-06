import { create } from "zustand";

export type ToolId = "changes" | "simulator" | "terminal";

interface LayoutState {
  /** Right-side tool rail */
  activeToolId: null | ToolId;
  /** Panel width fractions (0–1), shared between TitleBar and ResizablePanel */
  leftPanelWidth: number;
  leftSidebarVisible: boolean;
  setLeftPanelWidth: (w: number) => void;

  setToolPanelWidth: (w: number) => void;
  toggleLeftSidebar: () => void;
  toggleTool: (id: ToolId) => void;
  toolPanelWidth: number;
}

export const useLayoutStore = create<LayoutState>((set) => ({
  leftSidebarVisible: true,
  toggleLeftSidebar: () =>
    set((s) => ({ leftSidebarVisible: !s.leftSidebarVisible })),
  leftPanelWidth: 0.18,
  setLeftPanelWidth: (w) => set({ leftPanelWidth: w }),

  activeToolId: null,
  toolPanelWidth: 0.3,
  toggleTool: (id) =>
    set((s) => ({ activeToolId: s.activeToolId === id ? null : id })),
  setToolPanelWidth: (w) => set({ toolPanelWidth: w }),
}));
