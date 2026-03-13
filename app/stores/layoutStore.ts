import { create } from "zustand";

interface LayoutState {
  /** Panel width fractions (0–1), shared between TitleBar and ResizablePanel */
  leftPanelWidth: number;
  leftSidebarVisible: boolean;
  rightPanelWidth: number;
  rightSidebarVisible: boolean;
  setLeftPanelWidth: (w: number) => void;
  setRightPanelWidth: (w: number) => void;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
}

export const useLayoutStore = create<LayoutState>((set) => ({
  leftSidebarVisible: true,
  rightSidebarVisible: true,
  toggleLeftSidebar: () =>
    set((s) => ({ leftSidebarVisible: !s.leftSidebarVisible })),
  toggleRightSidebar: () =>
    set((s) => ({ rightSidebarVisible: !s.rightSidebarVisible })),
  leftPanelWidth: 0.18,
  rightPanelWidth: 0.35,
  setLeftPanelWidth: (w) => set({ leftPanelWidth: w }),
  setRightPanelWidth: (w) => set({ rightPanelWidth: w }),
}));
