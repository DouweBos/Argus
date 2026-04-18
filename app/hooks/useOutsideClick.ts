import { useEffect, type RefObject } from "react";

/**
 * Calls `onOutside` when a mousedown occurs outside the referenced element.
 * No-op while `enabled` is false. Pass a predicate as `shouldIgnore` to skip
 * dismissal for specific targets (e.g. resize handles, portalled overlays).
 */
export function useOutsideClick(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  onOutside: () => void,
  shouldIgnore?: (target: HTMLElement) => boolean,
) {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const handler = (e: MouseEvent) => {
      const node = ref.current;
      if (!node) {
        return;
      }
      const target = e.target as HTMLElement | null;
      if (!target || node.contains(target)) {
        return;
      }
      if (shouldIgnore?.(target)) {
        return;
      }
      onOutside();
    };

    document.addEventListener("mousedown", handler);

    return () => document.removeEventListener("mousedown", handler);
  }, [enabled, ref, onOutside, shouldIgnore]);
}
