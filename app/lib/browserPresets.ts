export type BrowserPresetId = string;

export interface BrowserPreset {
  id: BrowserPresetId;
  internalHeight: number;
  /** Fixed internal viewport width the website "sees". */
  internalWidth: number;
  label: string;
  /** "portrait" for mobile/tablet (16:9 portrait), "landscape" for desktop (16:9 landscape). */
  orientation: "landscape" | "portrait";
  /** Controls mobile-vs-desktop context options (isMobile, hasTouch, DPR). */
  screenPosition: "desktop" | "mobile";
  userAgent: string;
}

/** JSON-facing shape for custom presets in `.argus.json`. */
export interface BrowserPresetConfig {
  height: number;
  id: string;
  label?: string;
  user_agent?: string;
  width: number;
}

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const BROWSER_PRESETS: Record<string, BrowserPreset> = {
  desktop: {
    id: "desktop",
    label: "Desktop",
    internalHeight: 900,
    internalWidth: 1440,
    orientation: "landscape",
    screenPosition: "desktop",
    userAgent: DEFAULT_USER_AGENT,
  },
  tablet: {
    id: "tablet",
    label: "Tablet",
    internalHeight: 1024,
    internalWidth: 768,
    orientation: "portrait",
    screenPosition: "mobile",
    userAgent:
      "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  },
  mobile: {
    id: "mobile",
    label: "Mobile",
    internalHeight: 667,
    internalWidth: 375,
    orientation: "portrait",
    screenPosition: "mobile",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  },
};

export const BUILTIN_PRESET_IDS: string[] = ["desktop", "tablet", "mobile"];

/** Convert a custom preset config to a full BrowserPreset. */
function configToPreset(config: BrowserPresetConfig): BrowserPreset {
  const isPortrait = config.height > config.width;

  return {
    id: config.id,
    label: config.label ?? config.id,
    internalWidth: config.width,
    internalHeight: config.height,
    orientation: isPortrait ? "portrait" : "landscape",
    screenPosition: isPortrait ? "mobile" : "desktop",
    userAgent: config.user_agent ?? DEFAULT_USER_AGENT,
  };
}

/**
 * Resolve a preset ID to a full BrowserPreset. Checks built-ins first,
 * then custom presets, falls back to desktop.
 */
export function resolvePreset(
  id: string,
  customPresets: BrowserPresetConfig[],
): BrowserPreset {
  if (BROWSER_PRESETS[id]) {
    return BROWSER_PRESETS[id];
  }
  const custom = customPresets.find((p) => p.id === id);
  if (custom) {
    return configToPreset(custom);
  }

  return BROWSER_PRESETS.desktop;
}

/**
 * Return all preset IDs: built-ins first, then custom IDs that don't
 * collide with built-in names.
 */
export function getAllPresetIds(
  customPresets: BrowserPresetConfig[],
): string[] {
  const customIds = customPresets
    .map((p) => p.id)
    .filter((id) => !BUILTIN_PRESET_IDS.includes(id));

  return [...BUILTIN_PRESET_IDS, ...customIds];
}
