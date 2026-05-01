import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TagIcon } from "../../icons/Icons";
import { RefBadge, type RefType } from "../RefBadge/RefBadge";
import styles from "./RefBadgeList.module.css";

export interface RefBadgeListItem {
  current?: boolean;
  name: string;
  type: RefType;
}

export interface RefBadgeListProps {
  items: RefBadgeListItem[];
}

interface PopoverPos {
  left: number;
  top: number;
}

export function RefBadgeList({ items }: RefBadgeListProps) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<PopoverPos | null>(null);

  if (items.length === 0) {
    return null;
  }

  const open = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    setPos({ top: rect.bottom + 4, left: rect.right });
  };
  const close = () => setPos(null);

  return (
    <span
      ref={triggerRef}
      className={styles.wrapper}
      onMouseEnter={open}
      onMouseLeave={close}
    >
      <span
        aria-label={`${items.length} ref${items.length === 1 ? "" : "s"}`}
        className={styles.trigger}
      >
        <TagIcon size={10} />
        <span className={styles.count}>{items.length}</span>
      </span>
      {pos &&
        createPortal(
          <span
            className={styles.popover}
            role="tooltip"
            style={{ top: pos.top, left: pos.left }}
          >
            {items.map((item) => (
              <RefBadge
                key={`${item.type}:${item.name}`}
                name={item.name}
                type={item.type}
                current={item.current}
                size="sm"
              />
            ))}
          </span>,
          document.body,
        )}
    </span>
  );
}
