// Stack of view-level handlers for the Cmd+W / menu close intent. Views push
// a handler on mount and pop it on unmount. When the menu fires close-intent,
// the topmost handler runs first; if it returns `false` (or nothing is
// registered), the app falls through to closing the window.

type CloseIntentHandler = () => boolean | undefined;

const stack: CloseIntentHandler[] = [];

export function pushCloseIntentHandler(
  handler: CloseIntentHandler,
): () => void {
  stack.push(handler);

  return () => {
    const i = stack.lastIndexOf(handler);
    if (i >= 0) {
      stack.splice(i, 1);
    }
  };
}

// Returns true when a handler consumed the intent.
export function runCloseIntent(): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    const consumed = stack[i]();
    if (consumed !== false) {
      return true;
    }
  }

  return false;
}
