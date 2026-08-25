/**
 * Per-view scroll memory for the single shared `.aw-main` scroller: without it,
 * backing out of a deep transcript leaves the list view scrolled far down.
 */

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

export function useScrollRestore(
  ref: RefObject<HTMLElement | null>,
  key: string,
  /** Views that own their own scrolling (the transcript pins to the bottom). */
  enabled = true,
) {
  const positions = useRef(new Map<string, number>());
  const keyRef = useRef(key);

  // Remember where the outgoing view was before the new one paints over it.
  useLayoutEffect(() => {
    const prev = keyRef.current;
    keyRef.current = key;
    if (prev === key) {
      return;
    }
    const el = ref.current;
    if (!el) {
      return;
    }
    positions.current.set(prev, el.scrollTop);
    if (enabled) {
      el.scrollTop = positions.current.get(key) ?? 0;
    }
  }, [ref, key, enabled]);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const onScroll = () => positions.current.set(keyRef.current, el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });

    return () => el.removeEventListener("scroll", onScroll);
  }, [ref]);
}
