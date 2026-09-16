import { useEffect, useRef } from "react";
import { getTransport } from "../lib/transport";

type UnlistenFn = () => void;

/**
 * Subscribe to a backend event (local main process, or the attached host). The handler is stable across
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

    unlisten = getTransport().on<T>(event, (payload) => {
      handlerRef.current(payload);
    });

    return () => {
      unlisten?.();
    };
  }, [event]);
}
