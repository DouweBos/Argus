import { create } from "zustand";

interface DiagramViewerState {
  code: string | null;
}

const diagramViewerStore = create<DiagramViewerState>(() => ({
  code: null,
}));

export const openDiagramViewer = (code: string) => {
  diagramViewerStore.setState({ code });
};

export const closeDiagramViewer = () => {
  diagramViewerStore.setState({ code: null });
};

export const useDiagramViewerCode = () => diagramViewerStore((s) => s.code);
