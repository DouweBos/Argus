import { useCallback } from "react";
import type { Ref, RefCallback, RefObject } from "react";

/**
 * Merge multiple refs (object refs, callback refs, or null) into a single
 * callback ref. Useful when a component needs its own internal ref *and*
 * must forward a ref from a parent.
 */
export const useCombinedRef = <T>(
  ...refs: (Ref<T> | undefined)[]
): RefCallback<T> => {
  const combinedCallback = useCallback((node: T) => {
    refs.forEach((ref) => {
      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        (ref as RefObject<T>).current = node;
      }
    });
    // eslint-disable-next-line react-hooks/use-memo, react-hooks/exhaustive-deps
  }, refs);

  return combinedCallback;
};
