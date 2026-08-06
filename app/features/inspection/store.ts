import type { Capture, RawCapture, RendererMode } from "./types";
import type { InstalledApp } from "../../lib/ipc";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import {
  inspectionCapture,
  inspectionLaunchInjected,
  inspectionListApps,
  inspectionProbe,
  inspectionSetProperty,
} from "../../lib/ipc";
import sampleCaptureJson from "./__fixtures__/sample-capture.json";
import { normalizeCapture } from "./normalize";

interface ViewState {
  mode: RendererMode;
}

/**
 * Shown when the app can't be inspected yet: either a specific app is running
 * without injection (offer "restart with inspection"), or nothing inspectable is
 * foregrounded (offer an installed-app picker).
 */
interface LaunchPrompt {
  foregroundApp: string | null;
  isSpringboard: boolean;
}

interface InspectionState {
  activeCaptureId: string | null;
  captureError: string | null;
  captureOrder: string[];
  captures: Record<string, Capture>;
  capturing: boolean;
  /** Optional node id to treat as the hierarchy root — double-click sets this. */
  focusedRootNodeId: string | null;
  /** Installed apps for the picker; null until fetched. */
  installedApps: InstalledApp[] | null;
  /** A relaunch is in flight. */
  launching: boolean;
  /** A launch-with-injection prompt is showing instead of a capture. */
  launchPrompt: LaunchPrompt | null;
  /** In-flight / failed live-edit of the selected node's property. */
  propertyEdit: { error: string | null; saving: boolean };
  /** Free-text filter applied to the hierarchy tree. Empty string = no filter. */
  searchQuery: string;
  selectedNodeId: string | null;
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
  installedApps: null,
  launchPrompt: null,
  launching: false,
  propertyEdit: { saving: false, error: null },
  view: { mode: "2d" },
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
    launchPrompt: null,
  }));

  return id;
}

function errMsg(e: unknown): string {
  return typeof e === "string" ? e : ((e as Error).message ?? String(e));
}

/**
 * Inspect the device. Probes for the injected in-process server first: if it's
 * live, capture the native tree; otherwise surface a launch prompt (restart the
 * running app with injection, or pick an app when nothing's running) rather than
 * a raw error.
 */
export async function capture(deviceKey: string | null): Promise<void> {
  if (!deviceKey) {
    inspectionStore.setState({
      captureError: "No active device — boot an iOS/tvOS simulator first.",
    });

    return;
  }
  inspectionStore.setState({ capturing: true, captureError: null });
  try {
    const probe = await inspectionProbe(deviceKey);
    if (probe.injected) {
      const raw = await inspectionCapture<RawCapture>(deviceKey);
      addCapture(normalizeCapture(raw));

      return;
    }

    // Not injected — offer to launch. Fetch the app list so the picker (and the
    // running-app name lookup) is ready.
    const apps = await inspectionListApps(deviceKey).catch(() => []);
    inspectionStore.setState({
      installedApps: apps,
      launchPrompt: {
        foregroundApp: probe.foregroundApp,
        isSpringboard: probe.isSpringboard,
      },
    });
  } catch (e) {
    inspectionStore.setState({ captureError: errMsg(e) });
  } finally {
    inspectionStore.setState({ capturing: false });
  }
}

/**
 * Relaunch `bundleId` with the in-process library injected, then immediately
 * capture. This is the one-click path from both launch prompts.
 */
export async function relaunchWithInspection(
  deviceKey: string | null,
  bundleId: string,
): Promise<void> {
  if (!deviceKey) {
    return;
  }
  inspectionStore.setState({ launching: true, captureError: null });
  try {
    await inspectionLaunchInjected(deviceKey, bundleId);
    inspectionStore.setState({ launchPrompt: null });
    await capture(deviceKey);
  } catch (e) {
    inspectionStore.setState({ captureError: errMsg(e) });
  } finally {
    inspectionStore.setState({ launching: false });
  }
}

/**
 * Re-run native-inspect and replace the ACTIVE capture in place (same id), so a
 * refresh after a live edit keeps the current selection/focus/search. Node ids
 * are stable within a launch, so the selected node persists.
 */
async function refreshActiveCapture(deviceKey: string): Promise<void> {
  const { activeCaptureId } = inspectionStore.getState();
  if (!activeCaptureId) {
    return;
  }
  const raw = await inspectionCapture<RawCapture>(deviceKey);
  const next = normalizeCapture(raw);
  inspectionStore.setState((s) => ({
    captures: { ...s.captures, [activeCaptureId]: next },
  }));
}

/**
 * Live-edit a property on the selected node via `conductor native-set`, then
 * refresh the capture so the panel and overlay reflect the authoritative new
 * values. Whitelisted keys: text, alpha, hidden, backgroundColor, tintColor,
 * cornerRadius, borderWidth, borderColor, frame (see the in-process bridge).
 */
export async function setNodeProperty(
  deviceKey: string | null,
  nodeId: string,
  key: string,
  value: string,
): Promise<boolean> {
  if (!deviceKey) {
    inspectionStore.setState({
      propertyEdit: { saving: false, error: "No live device to edit against." },
    });

    return false;
  }
  inspectionStore.setState({ propertyEdit: { saving: true, error: null } });
  try {
    await inspectionSetProperty(deviceKey, nodeId, key, value);
    await refreshActiveCapture(deviceKey);
    inspectionStore.setState({ propertyEdit: { saving: false, error: null } });

    return true;
  } catch (e) {
    inspectionStore.setState({
      propertyEdit: { saving: false, error: errMsg(e) },
    });

    return false;
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
    installedApps: null,
    launchPrompt: null,
    launching: false,
    propertyEdit: { saving: false, error: null },
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

export const useCaptureStatus = () =>
  useInspectionStore(
    useShallow((s) => ({
      capturing: s.capturing,
      captureError: s.captureError,
    })),
  );

export const useRendererMode = () => useInspectionStore((s) => s.view.mode);

export const useLaunchPrompt = () =>
  useInspectionStore(
    useShallow((s) => ({
      launchPrompt: s.launchPrompt,
      installedApps: s.installedApps,
      launching: s.launching,
    })),
  );

export const usePropertyEdit = () => useInspectionStore((s) => s.propertyEdit);

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
    installedApps: null,
    launchPrompt: null,
    launching: false,
    propertyEdit: { saving: false, error: null },
    view: { mode: "2d" },
  });
};
