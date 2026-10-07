import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { mirrorToHost } from "../lib/hostPrefs";

export type DevicesViewMode = "grid" | "table";

const VIEW_MODE_KEY = "argus:devices:viewMode";
const SELECTED_KEY = "argus:devices:gridSelected";
const INTERACTIVE_KEY = "argus:devices:gridInteractive";
const TILE_SIZE_KEY = "argus:devices:gridTileSize";

/** Min column width (px) for a grid tile; bounds the slider range. */
export const MIN_TILE_SIZE = 180;
export const MAX_TILE_SIZE = 420;
const DEFAULT_TILE_SIZE = 260;

function loadTileSize(): number {
  try {
    const raw = Number(localStorage.getItem(TILE_SIZE_KEY));
    if (!Number.isFinite(raw) || raw < MIN_TILE_SIZE || raw > MAX_TILE_SIZE) {
      return DEFAULT_TILE_SIZE;
    }

    return raw;
  } catch {
    return DEFAULT_TILE_SIZE;
  }
}

function loadViewMode(): DevicesViewMode {
  try {
    return localStorage.getItem(VIEW_MODE_KEY) === "grid" ? "grid" : "table";
  } catch {
    return "table";
  }
}

function loadStringArray(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;

    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

function save(key: string, value: string[] | string) {
  try {
    localStorage.setItem(
      key,
      typeof value === "string" ? value : JSON.stringify(value),
    );
    mirrorToHost(key);
  } catch {
    // ignore storage failures
  }
}

interface DeviceGridStoreData {
  /** Device keys currently shown as interactive (tap/type) tiles. */
  interactiveKeys: string[];
  /** Device keys shown as live tiles in the grid, in selection order. */
  selectedKeys: string[];
  /** Min column width (px) driving grid tile size. */
  tileSize: number;
  viewMode: DevicesViewMode;
}

const deviceGridStore = create<DeviceGridStoreData>(() => ({
  viewMode: loadViewMode(),
  selectedKeys: loadStringArray(SELECTED_KEY),
  interactiveKeys: loadStringArray(INTERACTIVE_KEY),
  tileSize: loadTileSize(),
}));

export const setDevicesViewMode = (viewMode: DevicesViewMode) => {
  save(VIEW_MODE_KEY, viewMode);
  deviceGridStore.setState({ viewMode });
};

export const setGridTileSize = (tileSize: number) => {
  save(TILE_SIZE_KEY, String(tileSize));
  deviceGridStore.setState({ tileSize });
};

export function useGridTileSize(): number {
  return deviceGridStore((s) => s.tileSize);
}

/** Toggle a device's membership in the grid. */
export const toggleGridSelected = (key: string) => {
  deviceGridStore.setState((state) => {
    if (state.selectedKeys.includes(key)) {
      const selectedKeys = state.selectedKeys.filter((k) => k !== key);
      const interactiveKeys = state.interactiveKeys.filter((k) => k !== key);
      save(SELECTED_KEY, selectedKeys);
      save(INTERACTIVE_KEY, interactiveKeys);

      return { selectedKeys, interactiveKeys };
    }
    const selectedKeys = [...state.selectedKeys, key];
    save(SELECTED_KEY, selectedKeys);

    return { selectedKeys };
  });
};

export const removeGridSelected = (key: string) => {
  deviceGridStore.setState((state) => {
    const selectedKeys = state.selectedKeys.filter((k) => k !== key);
    const interactiveKeys = state.interactiveKeys.filter((k) => k !== key);
    save(SELECTED_KEY, selectedKeys);
    save(INTERACTIVE_KEY, interactiveKeys);

    return { selectedKeys, interactiveKeys };
  });
};

export const setGridInteractive = (key: string, on: boolean) => {
  deviceGridStore.setState((state) => {
    const has = state.interactiveKeys.includes(key);
    if (on === has) {
      return state;
    }
    const interactiveKeys = on
      ? [...state.interactiveKeys, key]
      : state.interactiveKeys.filter((k) => k !== key);
    save(INTERACTIVE_KEY, interactiveKeys);

    return { interactiveKeys };
  });
};

/**
 * Drop selected/interactive keys that no longer match a live device. Called on
 * each device poll so stale entries (shut-down sims) fall out of the grid.
 */
export const pruneGridSelection = (liveKeys: string[]) => {
  const live = new Set(liveKeys);
  deviceGridStore.setState((state) => {
    const selectedKeys = state.selectedKeys.filter((k) => live.has(k));
    const interactiveKeys = state.interactiveKeys.filter((k) => live.has(k));
    if (
      selectedKeys.length === state.selectedKeys.length &&
      interactiveKeys.length === state.interactiveKeys.length
    ) {
      return state;
    }
    save(SELECTED_KEY, selectedKeys);
    save(INTERACTIVE_KEY, interactiveKeys);

    return { selectedKeys, interactiveKeys };
  });
};

export function useDevicesViewMode(): DevicesViewMode {
  return deviceGridStore((s) => s.viewMode);
}

export function useDeviceGridSelection() {
  return deviceGridStore(
    useShallow((s) => ({
      selectedKeys: s.selectedKeys,
      interactiveKeys: s.interactiveKeys,
    })),
  );
}
