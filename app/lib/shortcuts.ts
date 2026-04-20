/**
 * Central registry of keyboard shortcuts. Define each shortcut once here; all
 * consumers (the global key handler in AppShell, the command palette, the home
 * screen hints, the title-bar pill) read their bindings and display keys from
 * this file.
 */

export type ShortcutId =
  | "command-palette"
  | "go-home"
  | "go-project-home"
  | "new-agent"
  | "new-session"
  | "next-agent-tab"
  | "open-repo"
  | "prev-agent-tab"
  | "settings"
  | "toggle-left-sidebar"
  | "toggle-right-panel";

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
  "new-session": { meta: true, key: "n", label: "New session" },
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
