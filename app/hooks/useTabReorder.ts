import type { DragEvent } from "react";
import { useCallback, useState } from "react";

export type DropPosition = "after" | "before";

export interface TabDropIndicator {
  position: DropPosition;
  targetId: string;
}

export interface UseTabReorderOptions {
  /**
   * Custom MIME type used to tag the drag. Distinct per consumer (agents,
   * terminals, …) so drops from unrelated drag sources are ignored.
   */
  mime: string;
  /** Optional: fired when a drag ends (including cancellation). */
  onDragEnd?: () => void;
  /** Optional: fired when a drag starts. Useful for cross-component broadcasts. */
  onDragStart?: (id: string) => void;
  /** Commit a reorder. `fromId` is the dragged tab, `targetId` is the drop target. */
  onReorder: (fromId: string, targetId: string, position: DropPosition) => void;
}

export interface UseTabReorderResult {
  /** Id of the tab currently being dragged (for e.g. opacity styling), or null. */
  draggingId: string | null;
  /** Returns the active drop-indicator side for a given tab id, or null. */
  getIndicator: (id: string) => DropPosition | null;
  handleDragEnd: () => void;
  handleDragLeave: (id: string) => void;
  handleDragOver: (e: DragEvent<HTMLElement>, id: string) => void;
  handleDragStart: (e: DragEvent<HTMLElement>, id: string) => void;
  handleDrop: (e: DragEvent<HTMLElement>, targetId: string) => void;
}

/**
 * Encapsulates the drag-and-drop reordering logic for a horizontal tab bar.
 *
 * Consumers wire the returned handlers onto each draggable/drop-target tab
 * element, pair them with the visual `dropBefore` / `dropAfter` classes, and
 * implement a concrete `onReorder` against their own store.
 *
 * Extracted from AgentTabBar so that TerminalTabs (and any future tab bar)
 * can share the same drag, hit-test, and indicator behaviour.
 */
export function useTabReorder({
  mime,
  onReorder,
  onDragEnd,
  onDragStart,
}: UseTabReorderOptions): UseTabReorderResult {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<TabDropIndicator | null>(
    null,
  );

  const handleDragStart = useCallback(
    (e: DragEvent<HTMLElement>, id: string) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData(mime, id);
      // Some browsers require data on the plain text type for drag to init.
      e.dataTransfer.setData("text/plain", id);
      setDraggingId(id);
      onDragStart?.(id);
    },
    [mime, onDragStart],
  );

  const handleDragEnd = useCallback(() => {
    setDraggingId(null);
    setDropIndicator(null);
    onDragEnd?.();
  }, [onDragEnd]);

  const handleDragOver = useCallback(
    (e: DragEvent<HTMLElement>, id: string) => {
      if (!draggingId || draggingId === id) {
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";

      const rect = e.currentTarget.getBoundingClientRect();
      const isBefore = e.clientX < rect.left + rect.width / 2;
      const position: DropPosition = isBefore ? "before" : "after";
      setDropIndicator((prev) =>
        prev && prev.targetId === id && prev.position === position
          ? prev
          : { targetId: id, position },
      );
    },
    [draggingId],
  );

  const handleDragLeave = useCallback((id: string) => {
    setDropIndicator((prev) => (prev && prev.targetId === id ? null : prev));
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLElement>, targetId: string) => {
      e.preventDefault();
      const fromId =
        e.dataTransfer.getData(mime) ||
        e.dataTransfer.getData("text/plain") ||
        draggingId;
      setDraggingId(null);
      const indicator = dropIndicator;
      setDropIndicator(null);
      if (!fromId || fromId === targetId) {
        return;
      }
      onReorder(fromId, targetId, indicator?.position ?? "before");
    },
    [mime, draggingId, dropIndicator, onReorder],
  );

  const getIndicator = useCallback(
    (id: string): DropPosition | null =>
      dropIndicator && dropIndicator.targetId === id
        ? dropIndicator.position
        : null,
    [dropIndicator],
  );

  return {
    draggingId,
    getIndicator,
    handleDragEnd,
    handleDragLeave,
    handleDragOver,
    handleDragStart,
    handleDrop,
  };
}
