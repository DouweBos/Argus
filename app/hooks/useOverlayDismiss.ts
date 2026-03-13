import { useCallback, useRef } from "react";

/**
 * Returns `onMouseDown` and `onClick` handlers for a dialog overlay that only
 * closes when the *entire* click (mousedown + mouseup) lands on the overlay
 * itself. This prevents dismissing the dialog when the user starts a text
 * selection inside the dialog and releases outside it.
 */
export function useOverlayDismiss(onClose: () => void) {
  const mouseDownTarget = useRef<EventTarget | null>(null);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    mouseDownTarget.current = e.target;
  }, []);

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      if (
        e.target === e.currentTarget &&
        mouseDownTarget.current === e.currentTarget
      ) {
        onClose();
      }
    },
    [onClose],
  );

  return { onMouseDown, onClick };
}
