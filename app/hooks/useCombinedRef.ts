import { useCallback } from "react";
import type { Ref, RefCallback } from "react";

/**
 * Merge multiple refs (object refs, callback refs, or null) into a single
 * callback ref. Useful when a component needs its own internal ref *and*
 * must forward a ref from a parent.
 */
export function useCombinedRef<T>(
  ...refs: (Ref<T> | undefined)[]
): RefCallback<T> {
  return useCallback(
    (node: null | T) => {
      for (const ref of refs) {
        if (!ref) continue;
        if (typeof ref === "function") {
          ref(node);
        } else {
          (ref as React.MutableRefObject<null | T>).current = node;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    refs,
  );
}
