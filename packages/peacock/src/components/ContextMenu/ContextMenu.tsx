import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import styles from "./ContextMenu.module.css";

export interface ContextMenuAction {
  danger?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  label: ReactNode;
  onClick: () => void;
  /** Shows a highlight + checkmark-style trailing mark on this row. */
  selected?: boolean;
  /** Small text on the right (shortcut, status, etc.). */
  trailing?: ReactNode;
}

export interface ContextMenuSeparator {
  separator: true;
}

export interface ContextMenuHeader {
  header: ReactNode;
}

export type ContextMenuItem =
  | ContextMenuAction
  | ContextMenuHeader
  | ContextMenuSeparator;

function isSeparator(item: ContextMenuItem): item is ContextMenuSeparator {
  return "separator" in item && item.separator === true;
}

function isHeader(item: ContextMenuItem): item is ContextMenuHeader {
  return "header" in item;
}

export interface ContextMenuPosition {
  x: number;
  y: number;
}

export interface ContextMenuProps {
  items: ContextMenuItem[];
  onClose: () => void;
  /** Viewport coordinates for the menu's top-left. Use a trigger's
   * `getBoundingClientRect()` (e.g. `{ x: rect.right - width, y: rect.bottom + 4 }`)
   * or the native event's `clientX/Y` for right-click menus. */
  position: ContextMenuPosition;
}

export function ContextMenu({ items, position, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    const handleScroll = () => onClose();

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("scroll", handleScroll, true);
    window.addEventListener("blur", onClose);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  useEffect(() => {
    if (!menuRef.current) {
      return;
    }
    const rect = menuRef.current.getBoundingClientRect();
    const pad = 8;
    let { x, y } = position;
    if (x + rect.width > window.innerWidth - pad) {
      x = window.innerWidth - rect.width - pad;
    }
    if (x < pad) {
      x = pad;
    }

    if (y + rect.height > window.innerHeight - pad) {
      y = window.innerHeight - rect.height - pad;
    }
    if (y < pad) {
      y = pad;
    }

    menuRef.current.style.left = `${x}px`;
    menuRef.current.style.top = `${y}px`;
  }, [position]);

  return createPortal(
    <div
      ref={menuRef}
      className={styles.menu}
      style={{ left: position.x, top: position.y }}
    >
      {items.map((item, i) => {
        if (isSeparator(item)) {
          return <div key={i} className={styles.separator} />;
        }
        if (isHeader(item)) {
          return (
            <div key={i} className={styles.header}>
              {item.header}
            </div>
          );
        }
        const classes = [
          styles.item,
          item.danger ? styles.danger : "",
          item.selected ? styles.itemSelected : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <button
            key={i}
            className={classes}
            disabled={item.disabled}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
              item.onClick();
            }}
          >
            {item.icon && <span className={styles.icon}>{item.icon}</span>}
            <span className={styles.label}>{item.label}</span>
            {item.trailing !== undefined && (
              <span className={styles.trailing}>{item.trailing}</span>
            )}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
