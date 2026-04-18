import { useEffect } from "react";

/**
 * Modal dismissal stack.
 *
 * Each open modal registers its `onClose` on mount and unregisters on unmount.
 * A single window-level `keydown` listener routes `Escape` to the topmost
 * registered modal, so nested/stacked modals dismiss one-at-a-time in LIFO
 * order — callers never need to wire up Escape themselves.
 */

const stack: (() => void)[] = [];
let listenerAttached = false;

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== "Escape") {
    return;
  }
  const top = stack[stack.length - 1];
  if (!top) {
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  top();
}

function ensureListener() {
  if (listenerAttached) {
    return;
  }
  listenerAttached = true;
  window.addEventListener("keydown", onKeyDown);
}

/**
 * Register `onClose` as the active Escape handler while this component is
 * mounted. Newer registrations take precedence (stack); when the topmost
 * modal unmounts the next one down becomes active again.
 */
export function useDismissOnEscape(onClose: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    ensureListener();
    stack.push(onClose);

    return () => {
      const idx = stack.lastIndexOf(onClose);
      if (idx !== -1) {
        stack.splice(idx, 1);
      }
    };
  }, [onClose, enabled]);
}
