/**
 * Central registry of keyboard shortcuts. Define each shortcut once here; all
 * consumers (the global key handler in AppShell, the command palette, the home
 * screen hints, the title-bar pill) read their bindings and display keys from
 * this file.
 */

export type ShortcutId =
  | "close-tab"
  | "command-palette"
  | "go-home"
  | "go-project-home"
  | "new-agent"
  | "new-session"
  | "new-tab"
  | "next-agent-tab"
  | "next-tab"
  | "open-palette"
  | "open-repo"
  | "prev-agent-tab"
  | "prev-tab"
  | "settings"
  | "toggle-bottom-panel"
  | "toggle-changes"
  | "toggle-debug"
  | "toggle-left-sidebar"
  | "toggle-right-panel"
  | "toggle-simulator"
  | "toggle-terminal";

export interface ShortcutDef {
  alt?: boolean;
  /** Primary key — lowercase single character or punctuation ("p", ",", "]"). */
  key: string;
  /** Human-readable description. */
  label: string;
  meta?: boolean;
  shift?: boolean;
}

export const SHORTCUTS: Record<ShortcutId, ShortcutDef> = {
  "command-palette": {
    meta: true,
    shift: true,
    key: "p",
    label: "Command palette",
  },
  "toggle-left-sidebar": {
    meta: true,
    key: "b",
    label: "Toggle left sidebar",
  },
  "toggle-right-panel": {
    meta: true,
    alt: true,
    key: "b",
    label: "Toggle right panel",
  },
  "open-repo": { meta: true, key: "o", label: "Open repo" },
  "open-palette": {
    meta: true,
    shift: true,
    key: "o",
    label: "Open project or session…",
  },
  "new-session": { meta: true, key: "n", label: "New session" },
  "toggle-bottom-panel": {
    meta: true,
    key: "j",
    label: "Toggle bottom panel",
  },
  "toggle-terminal": {
    meta: true,
    shift: true,
    key: "t",
    label: "Toggle terminal",
  },
  "toggle-debug": {
    meta: true,
    shift: true,
    key: "d",
    label: "Toggle device debugger",
  },
  "toggle-changes": {
    meta: true,
    shift: true,
    key: "g",
    label: "Toggle changes",
  },
  "toggle-simulator": {
    meta: true,
    shift: true,
    key: "m",
    label: "Toggle simulator",
  },
  "new-agent": { meta: true, shift: true, key: "a", label: "New agent" },
  settings: { meta: true, key: ",", label: "Settings" },
  "next-agent-tab": {
    meta: true,
    shift: true,
    key: "]",
    label: "Next agent tab",
  },
  "prev-agent-tab": {
    meta: true,
    shift: true,
    key: "[",
    label: "Previous agent tab",
  },
  "new-tab": { meta: true, key: "t", label: "New tab" },
  "close-tab": { meta: true, key: "w", label: "Close tab" },
  "next-tab": { meta: true, key: "Tab", label: "Next tab" },
  "prev-tab": { meta: true, shift: true, key: "Tab", label: "Previous tab" },
  "go-home": { meta: true, shift: true, key: "h", label: "Go to app home" },
  "go-project-home": {
    meta: true,
    alt: true,
    key: "h",
    label: "Go to project home",
  },
};

const KEY_LABELS: Record<string, string> = {
  ",": ",",
  Tab: "⇥",
  "[": "[",
  "]": "]",
};

function displayKey(key: string): string {
  return KEY_LABELS[key] ?? key.toUpperCase();
}

/** Display keys in macOS order (⌃ ⌥ ⇧ ⌘ key). Meta renders as ⌘. */
export function shortcutKeys(id: ShortcutId): string[] {
  const def = SHORTCUTS[id];
  const out: string[] = [];
  if (def.meta) {
    out.push("⌘");
  }
  if (def.alt) {
    out.push("⌥");
  }
  if (def.shift) {
    out.push("⇧");
  }
  out.push(displayKey(def.key));

  return out;
}

export function shortcutLabel(id: ShortcutId): string {
  return SHORTCUTS[id].label;
}
