/**
 * Hardware-keyboard shortcuts — an iPad with a Magic Keyboard is a common way
 * to drive this. A trimmed mirror of the desktop's set; only the ones that make
 * sense without the desktop's panels.
 */

import { useEffect } from "react";
import type { ShortcutCheatsheetEntry } from "@argus/peacock";

interface Options {
  back: () => void;
  /** Open the cheatsheet listing everything below. */
  onShowShortcuts: () => void;
  /** Absent on narrow layouts, where there is no sidebar to toggle. */
  onToggleSidebar?: () => void;
}

/** What `Cmd+/` lists — the same set this hook binds. */
export const WEB_SHORTCUTS: readonly ShortcutCheatsheetEntry[] = [
  {
    id: "back",
    label: "Back",
    combo: "Cmd+[",
    contexts: ["global"],
    scopes: ["project", "session"],
  },
  {
    id: "forward",
    label: "Forward",
    combo: "Cmd+]",
    contexts: ["global"],
    scopes: ["project", "session"],
  },
  {
    id: "toggle-sidebar",
    label: "Toggle sidebar",
    combo: "Cmd+\\",
    contexts: ["global"],
    scopes: ["project", "session"],
  },
  {
    id: "focus-composer",
    label: "Focus the message box",
    combo: "Cmd+K",
    contexts: ["global"],
    scopes: ["session"],
  },
  {
    id: "shortcuts",
    label: "Show shortcuts",
    combo: "Cmd+/",
    contexts: ["global"],
    scopes: ["project", "session"],
  },
];

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  );
}

export function useKeyboardShortcuts({
  back,
  onShowShortcuts,
  onToggleSidebar,
}: Options): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) {
        return;
      }

      if (e.key === "[") {
        e.preventDefault();
        back();
      } else if (e.key === "]") {
        e.preventDefault();
        window.history.forward();
      } else if (e.key === "\\" && onToggleSidebar) {
        e.preventDefault();
        onToggleSidebar();
      } else if (e.key === "k" && !isTypingTarget(e.target)) {
        e.preventDefault();
        document
          .querySelector<HTMLTextAreaElement>(".aw-chat-dock textarea")
          ?.focus();
      } else if (e.key === "/") {
        e.preventDefault();
        onShowShortcuts();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [back, onShowShortcuts, onToggleSidebar]);
}
