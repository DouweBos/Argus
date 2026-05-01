/**
 * DragLayer — globally-mounted floating badge that follows the cursor and
 * shows the active drop target's label while a drag is in progress.
 *
 * Mount once at the app shell. Renders nothing when no drag is active.
 *
 * The label switches automatically when ⌥ is held (alternate modifier).
 */

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useDndState } from "../../lib/dnd";
import styles from "./DragLayer.module.css";

export function DragLayer() {
  const state = useDndState();
  const badgeRef = useRef<HTMLDivElement>(null);
  const posRef = useRef({ x: 0, y: 0 });

  const isDragging = state.activePayload !== null;

  // Track cursor position via mousemove on document and move the badge.
  useEffect(() => {
    if (!isDragging) {
      return;
    }

    function onMouseMove(e: MouseEvent) {
      posRef.current = { x: e.clientX, y: e.clientY };
      if (badgeRef.current) {
        badgeRef.current.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 14}px)`;
      }
    }

    // HTML5 drag events fire dragover not mousemove; use dragover on document.
    function onDragOver(e: DragEvent) {
      posRef.current = { x: e.clientX, y: e.clientY };
      if (badgeRef.current) {
        badgeRef.current.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 14}px)`;
      }
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("dragover", onDragOver);

    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("dragover", onDragOver);
    };
  }, [isDragging]);

  if (!isDragging) {
    return null;
  }

  const usingShift = state.shiftHeld && state.shiftLabel !== null;
  const usingAlt = !usingShift && state.altHeld && state.altLabel !== null;
  let label: string | null;
  if (usingShift) {
    label = state.shiftLabel;
  } else if (usingAlt) {
    label = state.altLabel;
  } else {
    label = state.hoverLabel;
  }

  if (!label) {
    return null;
  }

  const initialTransform = `translate(${posRef.current.x + 14}px, ${posRef.current.y + 14}px)`;

  return createPortal(
    <div
      ref={badgeRef}
      className={`${styles.badge} ${usingAlt || usingShift ? styles.alt : ""}`}
      style={{ transform: initialTransform }}
      aria-hidden="true"
    >
      {label}
    </div>,
    document.body,
  );
}
