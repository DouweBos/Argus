import { useRef, useState } from "react";
import { EllipsisVerticalIcon } from "../../icons/Icons";
import { Chip } from "../Chip/Chip";
import {
  ContextMenu,
  type ContextMenuItem,
  type ContextMenuPosition,
} from "../ContextMenu/ContextMenu";
import styles from "./OverflowMenu.module.css";

const GAP = 4;

export interface OverflowMenuProps {
  items: ContextMenuItem[];
  /** Tooltip and accessible name. */
  title: string;
  /** Called when the menu opens. */
  onOpen?: () => void;
}

/** The ⋮ at the end of a toolbar: what has no chip of its own, in a menu opening upward. */
export function OverflowMenu({ items, title, onOpen }: OverflowMenuProps) {
  const [position, setPosition] = useState<ContextMenuPosition | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);

  const toggle = () => {
    const rect = anchor.current?.getBoundingClientRect();
    if (position || !rect) {
      setPosition(null);

      return;
    }
    setPosition({ x: rect.left, y: rect.top - GAP });
    onOpen?.();
  };

  return (
    <>
      <span
        className={styles.anchor}
        ref={anchor}
        // The menu's outside-press dismissal would beat the click that closes it.
        onMouseDown={(e) => position && e.stopPropagation()}
      >
        <Chip
          bare
          interactive
          aria-expanded={position !== null}
          aria-haspopup="menu"
          aria-label={title}
          role="button"
          tabIndex={0}
          title={title}
          leading={<EllipsisVerticalIcon size={14} />}
          onClick={toggle}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggle();
            }
          }}
        />
      </span>
      {position && (
        <ContextMenu
          items={items}
          placement="above"
          position={position}
          triggerRef={anchor}
          onClose={() => setPosition(null)}
        />
      )}
    </>
  );
}
