/**
 * The window chrome's remembered state, per browser: which projects are folded
 * in the sidebar, and whether the side panel is open and on which tab. Like
 * the Mac's `SidebarCollapse` and panel model, this is layout, not a screen,
 * so it lives beside the URL rather than in it.
 */

import { create } from "zustand";

export type SidePanelTab = "changes" | "device" | "terminal";

const COLLAPSED_KEY = "argus.web.sidebar.collapsed";
const PANEL_KEY = "argus.web.sidePanel";
const PANEL_WIDTH_KEY = "argus.web.sidePanel.width";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);

    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable: the choice lasts this visit
  }
}

interface PanelPref {
  open: boolean;
  tab: SidePanelTab;
}

interface ShellPrefs {
  collapsed: string[];
  panel: PanelPref;
  toggleCollapsed: (repoRoot: string) => void;
  setPanelOpen: (open: boolean) => void;
  setPanelTab: (tab: SidePanelTab) => void;
}

const isTab = (v: unknown): v is SidePanelTab =>
  v === "changes" || v === "device" || v === "terminal";

function readPanel(): PanelPref {
  const raw = read<Partial<PanelPref>>(PANEL_KEY, {});

  return { open: raw.open === true, tab: isTab(raw.tab) ? raw.tab : "device" };
}

export const useShellPrefs = create<ShellPrefs>((set, get) => ({
  collapsed: read<string[]>(COLLAPSED_KEY, []),
  panel: readPanel(),
  toggleCollapsed: (repoRoot) => {
    const now = get().collapsed;
    const collapsed = now.includes(repoRoot)
      ? now.filter((r) => r !== repoRoot)
      : [...now, repoRoot];
    write(COLLAPSED_KEY, collapsed);
    set({ collapsed });
  },
  setPanelOpen: (open) => {
    const panel = { ...get().panel, open };
    write(PANEL_KEY, panel);
    set({ panel });
  },
  setPanelTab: (tab) => {
    const panel = { open: true, tab };
    write(PANEL_KEY, panel);
    set({ panel });
  },
}));

export function loadPanelWidth(): number {
  const width = read<number>(PANEL_WIDTH_KEY, 380);

  return Number.isFinite(width) ? width : 380;
}

export function savePanelWidth(width: number): void {
  write(PANEL_WIDTH_KEY, Math.round(width));
}
