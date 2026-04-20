import type { DragEvent, ReactNode } from "react";
import { useCallback, useState } from "react";
import {
  isAgentDrag,
  readDraggedAgentId,
  useDraggingAgentId,
} from "../agentDragDrop";
import styles from "./AgentChatDropZone.module.css";

type Side = "left" | "right";

interface SplitDropProps {
  children: ReactNode;
  /** Optional agent ids that should not produce a drop (self). */
  ignoreIds?: string[];
  /** Called when an agent tab is dropped on the left half. */
  onDropLeft: (agentId: string) => void;
  /** Called when an agent tab is dropped on the right half. */
  onDropRight: (agentId: string) => void;
}

interface SingleDropProps {
  children: ReactNode;
  ignoreIds?: string[];
  label?: string;
  /** Single-target drop — covers the whole pane, no halves shown. */
  onDrop: (agentId: string) => void;
}

/**
 * Wraps a pane with drop targets for agent-tab drags. Overlay visibility is
 * driven by the module-level `useDraggingAgentId` signal (toggled by the
 * tab bar's dragstart / dragend) so it can never get stuck — dragend always
 * fires on the source tab, even for cancelled drags.
 */
export function AgentSplitDropZone({
  children,
  onDropLeft,
  onDropRight,
  ignoreIds,
}: SplitDropProps) {
  const draggingId = useDraggingAgentId();
  const [hoverSide, setHoverSide] = useState<Side | null>(null);

  const isIgnored = useCallback(
    (id: string | null) => !id || (ignoreIds?.includes(id) ?? false),
    [ignoreIds],
  );

  const active = !!draggingId && !isIgnored(draggingId);

  const onDragOverHalf = (e: DragEvent, side: Side) => {
    if (!isAgentDrag(e.dataTransfer)) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setHoverSide(side);
  };

  const onDropHalf = (e: DragEvent, side: Side) => {
    e.preventDefault();
    e.stopPropagation();
    const id = readDraggedAgentId(e.dataTransfer);
    setHoverSide(null);
    if (isIgnored(id)) {
      return;
    }
    if (side === "left") {
      onDropLeft(id!);
    } else {
      onDropRight(id!);
    }
  };

  return (
    <div className={styles.wrap}>
      {children}
      <div
        className={`${styles.overlay} ${active ? styles.active : ""}`}
        aria-hidden={!active}
      >
        <div
          className={`${styles.half} ${hoverSide === "left" ? styles.hover : ""}`}
          onDragOver={(e) => onDragOverHalf(e, "left")}
          onDragLeave={() => setHoverSide((s) => (s === "left" ? null : s))}
          onDrop={(e) => onDropHalf(e, "left")}
        >
          <span className={styles.hint}>Open here</span>
        </div>
        <div
          className={`${styles.half} ${hoverSide === "right" ? styles.hover : ""}`}
          onDragOver={(e) => onDragOverHalf(e, "right")}
          onDragLeave={() => setHoverSide((s) => (s === "right" ? null : s))}
          onDrop={(e) => onDropHalf(e, "right")}
        >
          <span className={styles.hint}>Open on right</span>
        </div>
      </div>
    </div>
  );
}

export function AgentSingleDropZone({
  children,
  onDrop,
  ignoreIds,
  label = "Drop to open here",
}: SingleDropProps) {
  const draggingId = useDraggingAgentId();
  const [hover, setHover] = useState(false);

  const isIgnored = useCallback(
    (id: string | null) => !id || (ignoreIds?.includes(id) ?? false),
    [ignoreIds],
  );

  const active = !!draggingId && !isIgnored(draggingId);

  const onDragOver = (e: DragEvent) => {
    if (!isAgentDrag(e.dataTransfer)) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setHover(true);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const id = readDraggedAgentId(e.dataTransfer);
    setHover(false);
    if (isIgnored(id)) {
      return;
    }
    onDrop(id!);
  };

  return (
    <div className={styles.wrap}>
      {children}
      <div
        className={`${styles.overlay} ${styles.single} ${active ? styles.active : ""}`}
        aria-hidden={!active}
      >
        <div
          className={`${styles.half} ${hover ? styles.hover : ""}`}
          onDragOver={onDragOver}
          onDragLeave={() => setHover(false)}
          onDrop={handleDrop}
        >
          <span className={styles.hint}>{label}</span>
        </div>
      </div>
    </div>
  );
}
