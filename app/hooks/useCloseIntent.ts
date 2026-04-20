import { useEffect, useRef } from "react";
import { pushCloseIntentHandler } from "../lib/closeIntent";

// Register a view-level handler for Cmd+W / menu close intent. The topmost
// registered handler runs first. Return `false` explicitly to let the next
// handler (or the app-level fallback) take over; any other return value is
// treated as consumed.
export function useCloseIntent(handler: () => boolean | undefined): void {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    return pushCloseIntentHandler(() => handlerRef.current());
  }, []);
}
