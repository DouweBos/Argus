import { useEffect } from "react";

interface Modifiers {
  alt?: boolean;
  meta?: boolean;
  shift?: boolean;
}
interface Shortcut extends Modifiers {
  handler: (e: KeyboardEvent) => void;
  key: string;
}

const isEditable = (el: EventTarget | null): boolean => {
  if (!(el instanceof HTMLElement)) {
    return false;
  }
  if (el.isContentEditable) {
    return true;
  }

  const tag = el.tagName;

  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
};

/**
 * Match a shortcut definition's key against the keyboard event. Letters are
 * matched by `e.code` (e.g. "KeyB") so they survive macOS's Alt-as-modifier
 * remapping — `Alt+B` reports `e.key === "∫"` but `e.code === "KeyB"`. Other
 * keys (punctuation, named keys) compare against `e.key`.
 */
const matchesShortcutKey = (defKey: string, e: KeyboardEvent): boolean => {
  if (/^[a-z]$/i.test(defKey)) {
    return e.code === `Key${defKey.toUpperCase()}`;
  }
  if (/^[0-9]$/.test(defKey)) {
    return e.code === `Digit${defKey}` || e.code === `Numpad${defKey}`;
  }

  return defKey.toLowerCase() === e.key.toLowerCase();
};

/** Register window-level keyboard shortcuts. Ignores events from editable fields unless meta is required. */
export function useGlobalShortcuts(shortcuts: Shortcut[]): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      for (const s of shortcuts) {
        if (!matchesShortcutKey(s.key, e)) {
          continue;
        }
        if (!!s.meta !== meta) {
          continue;
        }
        if (!!s.shift !== e.shiftKey) {
          continue;
        }
        if (!!s.alt !== e.altKey) {
          continue;
        }
        // Allow meta-shortcuts even in inputs (it's a deliberate action).
        if (!s.meta && isEditable(e.target)) {
          continue;
        }
        e.preventDefault();
        s.handler(e);

        return;
      }
    };
    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [shortcuts]);
}
