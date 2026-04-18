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

/** Register window-level keyboard shortcuts. Ignores events from editable fields unless meta is required. */
export function useGlobalShortcuts(shortcuts: Shortcut[]): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      for (const s of shortcuts) {
        if (s.key.toLowerCase() !== e.key.toLowerCase()) {
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
