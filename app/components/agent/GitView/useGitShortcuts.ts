/**
 * Single keyboard listener that dispatches any `GIT_SHORTCUTS` entry whose
 * combo matches the current event to the handler the caller registered for
 * that shortcut id.
 *
 * Replaces three duplicated `useGlobalShortcuts` blocks in `GitView`,
 * `DiffViewer`, `ChangesToolbar`. Mounting GitView (or a sub-view) with the
 * appropriate handlers is sufficient to implicitly gate by context — only
 * mounted handlers fire.
 */

import { useEffect, useRef } from "react";
import {
  GIT_SHORTCUTS,
  type GitShortcutHandlers,
  type GitShortcutScope,
} from "./shortcuts";

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
 * Match a shortcut definition's key against the keyboard event. Letters
 * compare against `e.code` (so `Alt+B` works on macOS where `e.key` becomes
 * `∫`); other keys compare against `e.key`.
 */
const matches = (defKey: string, e: KeyboardEvent): boolean => {
  if (/^[a-z]$/i.test(defKey)) {
    return e.code === `Key${defKey.toUpperCase()}`;
  }
  if (/^[0-9]$/.test(defKey)) {
    return e.code === `Digit${defKey}` || e.code === `Numpad${defKey}`;
  }
  // Arrow keys — `Right` / `Left` / `Up` / `Down` shorthand.
  if (/^(Right|Left|Up|Down)$/i.test(defKey)) {
    return (
      e.key ===
      `Arrow${defKey[0]!.toUpperCase()}${defKey.slice(1).toLowerCase()}`
    );
  }
  // Bracket / slash / backslash — compare against `e.code` so they're stable
  // across keyboard layouts, falling back to `e.key`.
  const codeMap: Record<string, string> = {
    "[": "BracketLeft",
    "]": "BracketRight",
    "\\": "Backslash",
    "/": "Slash",
  };
  if (codeMap[defKey] && e.code === codeMap[defKey]) {
    return true;
  }

  return defKey.toLowerCase() === e.key.toLowerCase();
};

export function useGitShortcuts(
  scope: GitShortcutScope,
  handlers: GitShortcutHandlers,
): void {
  // Stash handlers in a ref so callers don't need to memoise — we re-read
  // on every keypress instead of re-binding the listener.
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      for (const def of GIT_SHORTCUTS) {
        if (!def.scopes.includes(scope)) {
          continue;
        }
        const m = def.matcher;
        if (!matches(m.key, e)) {
          continue;
        }
        if (m.meta !== meta) {
          continue;
        }
        if (m.shift !== e.shiftKey) {
          continue;
        }
        if (m.alt !== e.altKey) {
          continue;
        }
        const handler = handlersRef.current[def.id];
        if (!handler) {
          continue;
        }
        // When focus is in an editable field, skip shortcuts that would
        // hijack native text-editing behaviour. Plain (non-meta) shortcuts
        // never fire there; meta shortcuts that collide with universal
        // editing combos (Cmd+A/C/X/V/Z) are also let through to the field.
        if (isEditable(e.target)) {
          if (!m.meta) {
            continue;
          }
          if (
            !m.shift &&
            !m.alt &&
            (m.key === "a" ||
              m.key === "c" ||
              m.key === "x" ||
              m.key === "v" ||
              m.key === "z")
          ) {
            continue;
          }
        }
        e.preventDefault();
        handler();

        return;
      }
    };
    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [scope]);
}
