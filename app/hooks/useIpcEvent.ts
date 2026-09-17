import type { HostId } from "../lib/transport/hostId";
import { useEffect, useRef } from "react";
import { subscribe } from "../lib/transport";

type UnlistenFn = () => void;

/**
 * Subscribe to a backend event from every attached host, or from one named
 * host. The handler is stable across re-renders via a ref so callers do not
 * need to memoize it.
 */
export function useIpcEvent<T>(
  event: string,
  handler: (payload: T, hostId: HostId) => void,
  hostId?: HostId,
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

    unlisten = subscribe(
      event,
      (payload, from) => {
        handlerRef.current(payload as T, from);
      },
      hostId,
    );

    return () => {
      unlisten?.();
    };
  }, [event, hostId]);
}
