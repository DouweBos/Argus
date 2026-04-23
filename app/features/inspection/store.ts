import type { Capture, HierarchyNode, RawCapture, RendererMode } from "./types";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { inspectionCapture } from "../../lib/ipc";
import sampleCaptureJson from "./__fixtures__/sample-capture.json";
import { normalizeCapture } from "./normalize";

interface ViewState {
  mode: RendererMode;
}

export type SidebarTab = "a11y" | "hierarchy";

interface InspectionState {
  activeCaptureId: string | null;
  captureError: string | null;
  captureOrder: string[];
  captures: Record<string, Capture>;
  capturing: boolean;
  /** Optional node id to treat as the hierarchy root — double-click sets this. */
  focusedRootNodeId: string | null;
  /** Free-text filter applied to the hierarchy tree. Empty string = no filter. */
  searchQuery: string;
  selectedNodeId: string | null;
  /** Which sidebar tab is active; a11y badges render when this is "a11y". */
  sidebarTab: SidebarTab;
  view: ViewState;
}

const inspectionStore = create<InspectionState>(() => ({
  captures: {},
  captureOrder: [],
  activeCaptureId: null,
  selectedNodeId: null,
  focusedRootNodeId: null,
  searchQuery: "",
  capturing: false,
  captureError: null,
  view: { mode: "2d" },
  sidebarTab: "hierarchy",
}));

export const useInspectionStore = inspectionStore;

function makeId(): string {
  return `cap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function addCapture(entry: Capture): string {
  const id = makeId();
  inspectionStore.setState((s) => ({
    captures: { ...s.captures, [id]: entry },
    captureOrder: [...s.captureOrder, id],
    activeCaptureId: id,
    selectedNodeId: null,
    focusedRootNodeId: null,
    searchQuery: "",
    captureError: null,
  }));

  return id;
}

/** Trigger a live capture against the given device key. */
export async function capture(deviceKey: string | null): Promise<void> {
  if (!deviceKey) {
    inspectionStore.setState({
      captureError: "No active device — select a simulator/emulator first.",
    });

    return;
  }
  inspectionStore.setState({ capturing: true, captureError: null });
  try {
    const raw = await inspectionCapture<RawCapture>(deviceKey);
    addCapture(normalizeCapture(raw));
  } catch (e) {
    const msg = typeof e === "string" ? e : ((e as Error).message ?? String(e));
    inspectionStore.setState({ captureError: msg });
  } finally {
    inspectionStore.setState({ capturing: false });
  }
}

/** Dev-only helper — load the bundled fixture so the UI works without a live conductor. */
export function loadFixtureCapture(): string {
  return addCapture(sampleCaptureJson as unknown as Capture);
}

export function clearCaptures(): void {
  inspectionStore.setState({
    captures: {},
    captureOrder: [],
    activeCaptureId: null,
    selectedNodeId: null,
    focusedRootNodeId: null,
    searchQuery: "",
    captureError: null,
  });
}

export function selectCapture(id: string | null): void {
  inspectionStore.setState({
    activeCaptureId: id,
    selectedNodeId: null,
    focusedRootNodeId: null,
    searchQuery: "",
  });
}

export function selectNode(nodeId: string | null): void {
  inspectionStore.setState({ selectedNodeId: nodeId });
}

export function focusOnNode(nodeId: string | null): void {
  inspectionStore.setState({
    focusedRootNodeId: nodeId,
    selectedNodeId: nodeId,
  });
}

export function setSearchQuery(query: string): void {
  inspectionStore.setState({ searchQuery: query });
}

export const useFocusedRootNodeId = () =>
  useInspectionStore((s) => s.focusedRootNodeId);

export const useSearchQuery = () => useInspectionStore((s) => s.searchQuery);

export function setSidebarTab(tab: SidebarTab): void {
  inspectionStore.setState({ sidebarTab: tab });
}

export function setRendererMode(mode: RendererMode): void {
  inspectionStore.setState({ view: { mode } });
}

// Selectors
export const useActiveCapture = (): Capture | null =>
  useInspectionStore((s) =>
    s.activeCaptureId ? (s.captures[s.activeCaptureId] ?? null) : null,
  );

export const useCaptureList = () =>
  useInspectionStore(
    useShallow((s) => ({
      activeCaptureId: s.activeCaptureId,
      captureOrder: s.captureOrder,
      captures: s.captures,
    })),
  );

export const useInspectionSelection = () =>
  useInspectionStore(
    useShallow((s) => ({
      selectedNodeId: s.selectedNodeId,
    })),
  );

export const useA11yOverlayState = () =>
  useInspectionStore(
    useShallow((s) => ({ showBadges: s.sidebarTab === "a11y" })),
  );

export const useSidebarTab = () => useInspectionStore((s) => s.sidebarTab);

export const useCaptureStatus = () =>
  useInspectionStore(
    useShallow((s) => ({
      capturing: s.capturing,
      captureError: s.captureError,
    })),
  );

export const useRendererMode = () => useInspectionStore((s) => s.view.mode);

/**
 * First node in the active capture with `state.focused === true`. On tvOS the
 * OS-level focus is the primary navigation target; on other platforms this is
 * typically a focused text field. Returns null when no node is focused.
 */
function findFocusedNode(root: HierarchyNode): HierarchyNode | null {
  if (root.state.focused) {
    return root;
  }
  for (const child of root.children) {
    const hit = findFocusedNode(child);
    if (hit) {
      return hit;
    }
  }

  return null;
}

export const useFocusedNode = (): HierarchyNode | null =>
  useInspectionStore((s) => {
    const cap = s.activeCaptureId ? s.captures[s.activeCaptureId] : null;

    return cap ? findFocusedNode(cap.hierarchy) : null;
  });

// Test / debug hooks
export const getInspectionState = () => inspectionStore.getState();
export const setInspectionState =
  inspectionStore.setState.bind(inspectionStore);
export const resetInspectionState = (): void => {
  inspectionStore.setState({
    captures: {},
    captureOrder: [],
    activeCaptureId: null,
    selectedNodeId: null,
    focusedRootNodeId: null,
    searchQuery: "",
    capturing: false,
    captureError: null,
    view: { mode: "2d" },
    sidebarTab: "hierarchy",
  });
};
