import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import styles from "./ContextMenu.module.css";

export interface ContextMenuAction {
  danger?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  label: string;
  onClick: () => void;
}

export interface ContextMenuSeparator {
  separator: true;
}

export type ContextMenuItem = ContextMenuAction | ContextMenuSeparator;

function isSeparator(item: ContextMenuItem): item is ContextMenuSeparator {
  return "separator" in item && item.separator;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  onClose: () => void;
  /** "anchor" positions below parent element; {x,y} positions at fixed coords (right-click). */
  position: "anchor" | { x: number; y: number };
}

export function ContextMenu({ items, position, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click-outside, Escape, and scroll
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
    // Capture scroll on any ancestor — not just window
    document.addEventListener("scroll", handleScroll, true);
    window.addEventListener("blur", onClose);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  // Clamp fixed-position menus to the viewport after first render
  useEffect(() => {
    if (position === "anchor" || !menuRef.current) {
      return;
    }
    const rect = menuRef.current.getBoundingClientRect();
    const pad = 8;
    let { x, y } = position;
    if (x + rect.width > window.innerWidth - pad) {
      x = window.innerWidth - rect.width - pad;
    }

    if (y + rect.height > window.innerHeight - pad) {
      y = window.innerHeight - rect.height - pad;
    }

    menuRef.current.style.left = `${x}px`;
    menuRef.current.style.top = `${y}px`;
  }, [position]);

  const menuContent = (
    <div
      ref={menuRef}
      className={`${styles.menu} ${position !== "anchor" ? styles.fixed : ""}`}
      style={
        position !== "anchor"
          ? { left: position.x, top: position.y }
          : undefined
      }
    >
      {items.map((item, i) =>
        isSeparator(item) ? (
          <div key={i} className={styles.separator} />
        ) : (
          <button
            key={i}
            className={`${styles.item} ${item.danger ? styles.danger : ""}`}
            disabled={item.disabled}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
              item.onClick();
            }}
          >
            {item.icon && <span className={styles.icon}>{item.icon}</span>}
            {item.label}
          </button>
        ),
      )}
    </div>
  );

  // Fixed mode: portal to body. Anchor mode: render inline (caller positions).
  if (position !== "anchor") {
    return createPortal(menuContent, document.body);
  }

  return menuContent;
}
