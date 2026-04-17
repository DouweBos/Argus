import { useEffect, useRef } from "react";

type UnlistenFn = () => void;

/**
 * Subscribe to an Electron backend event. The handler is stable across
 * re-renders via a ref so callers do not need to memoize it.
 */
export function useIpcEvent<T>(
  event: string,
  handler: (payload: T) => void,
): void {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!event) {
      return;
    }
    let unlisten: UnlistenFn | null = null;

    unlisten = window.argus.on<T>(event, (payload) => {
      handlerRef.current(payload);
    });

    return () => {
      unlisten?.();
    };
  }, [event]);
}
