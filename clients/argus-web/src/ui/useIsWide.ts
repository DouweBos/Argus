/**
 * Tablet/desktop breakpoint. 900px clears a portrait iPad (834pt) so the
 * two-pane layout is on in both orientations, but never on a phone.
 */

import { useSyncExternalStore } from "react";

export const WIDE_QUERY = "(min-width: 900px)";

const query =
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia(WIDE_QUERY)
    : null;

function subscribe(onChange: () => void): () => void {
  query?.addEventListener("change", onChange);

  return () => query?.removeEventListener("change", onChange);
}

export function useIsWide(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => query?.matches ?? false,
    () => false,
  );
}
