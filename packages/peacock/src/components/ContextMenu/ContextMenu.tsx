import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ChevronRightIcon } from "../../icons/Icons";
import styles from "./ContextMenu.module.css";

export interface ContextMenuAction {
  /** Nested submenu items. When present, the row opens a submenu on hover or
   * click instead of firing `onClick`. `onClick` is ignored if `children`
   * has at least one entry. */
  children?: ContextMenuItem[];
  danger?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  label: ReactNode;
  onClick?: () => void;
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
  /** Closes the entire menu chain (including any open submenus). */
  onClose: () => void;
  /** Hover handlers for nested submenus to keep their parent's
   * close-timer in sync. Internal use — submenus pass these in. */
  onMenuMouseEnter?: () => void;
  onMenuMouseLeave?: () => void;
  /** Viewport coordinates for the menu's top-left. Use a trigger's
   * `getBoundingClientRect()` (e.g. `{ x: rect.right - width, y: rect.bottom + 4 }`)
   * or the native event's `clientX/Y` for right-click menus. */
  position: ContextMenuPosition;
  /** When true, this menu is a child submenu — disables its own
   * outside-click / scroll dismissal so dismissal is owned by the root. */
  submenu?: boolean;
  /** Fixed pixel width applied to the menu and inherited by its submenus.
   * Defaults to 240px so menus render consistently regardless of content. */
  width?: number;
}

interface OpenSubmenu {
  index: number;
  position: ContextMenuPosition;
}

const DEFAULT_MENU_WIDTH = 240;

export function ContextMenu({
  items,
  position,
  onClose,
  submenu = false,
  onMenuMouseEnter,
  onMenuMouseLeave,
  width = DEFAULT_MENU_WIDTH,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [openSubmenu, setOpenSubmenu] = useState<OpenSubmenu | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const cancelOpenTimer = () => {
    if (openTimerRef.current != null) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  };
  const cancelCloseTimer = () => {
    if (closeTimerRef.current != null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  // Submenus delegate dismissal to the root: a click outside the entire
  // menu chain closes everything. Detection walks up from the click target
  // looking for any element flagged with `data-context-menu`.
  useEffect(() => {
    if (submenu) {
      return;
    }
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-context-menu="true"]')) {
        return;
      }
      onClose();
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
  }, [onClose, submenu]);

  useEffect(
    () => () => {
      cancelOpenTimer();
      cancelCloseTimer();
    },
    [],
  );

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

  const computeSubmenuPosition = (rowRect: DOMRect): ContextMenuPosition => {
    const menuRect = menuRef.current?.getBoundingClientRect();
    const pad = 8;
    const parentRight = menuRect?.right ?? rowRect.right;
    const parentLeft = menuRect?.left ?? rowRect.left;
    let x = parentRight;
    if (x + width > window.innerWidth - pad) {
      x = parentLeft - width;
    }

    return { x, y: rowRect.top - 4 };
  };

  const scheduleOpenSubmenu = (index: number, rect: DOMRect, delay = 120) => {
    cancelOpenTimer();
    cancelCloseTimer();
    openTimerRef.current = window.setTimeout(() => {
      setOpenSubmenu({ index, position: computeSubmenuPosition(rect) });
    }, delay);
  };

  const scheduleCloseSubmenu = (delay = 200) => {
    cancelOpenTimer();
    cancelCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setOpenSubmenu(null);
    }, delay);
  };

  const openSubmenuItem =
    openSubmenu &&
    !isSeparator(items[openSubmenu.index]) &&
    !isHeader(items[openSubmenu.index])
      ? (items[openSubmenu.index] as ContextMenuAction)
      : null;

  return createPortal(
    <>
      <div
        ref={menuRef}
        className={styles.menu}
        data-context-menu="true"
        style={{ left: position.x, top: position.y, width }}
        onMouseEnter={() => {
          cancelCloseTimer();
          onMenuMouseEnter?.();
        }}
        onMouseLeave={() => {
          onMenuMouseLeave?.();
        }}
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

          const hasChildren =
            Array.isArray(item.children) && item.children.length > 0;
          const isOpen = openSubmenu?.index === i;
          const classes = [
            styles.item,
            item.danger ? styles.danger : "",
            item.selected ? styles.itemSelected : "",
            isOpen ? styles.itemSubmenuOpen : "",
          ]
            .filter(Boolean)
            .join(" ");

          const handleRowClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
            e.stopPropagation();
            if (hasChildren) {
              cancelOpenTimer();
              cancelCloseTimer();
              if (isOpen) {
                setOpenSubmenu(null);
              } else {
                const rect = e.currentTarget.getBoundingClientRect();
                setOpenSubmenu({
                  index: i,
                  position: computeSubmenuPosition(rect),
                });
              }

              return;
            }
            onClose();
            item.onClick?.();
          };

          const handleRowMouseEnter = (
            e: ReactMouseEvent<HTMLButtonElement>,
          ) => {
            cancelCloseTimer();
            if (hasChildren) {
              scheduleOpenSubmenu(i, e.currentTarget.getBoundingClientRect());
            } else if (openSubmenu) {
              // Hovered a sibling without children → close the submenu.
              scheduleCloseSubmenu(0);
            }
          };

          const handleRowMouseLeave = () => {
            if (hasChildren && !isOpen) {
              cancelOpenTimer();
            }
          };

          return (
            <button
              key={i}
              className={classes}
              disabled={item.disabled}
              onClick={handleRowClick}
              onMouseEnter={handleRowMouseEnter}
              onMouseLeave={handleRowMouseLeave}
            >
              {item.icon && <span className={styles.icon}>{item.icon}</span>}
              <span className={styles.label}>{item.label}</span>
              {item.trailing !== undefined && (
                <span className={styles.trailing}>{item.trailing}</span>
              )}
              {hasChildren && (
                <span className={styles.submenuChevron} aria-hidden>
                  <ChevronRightIcon size={10} />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {openSubmenu && openSubmenuItem?.children && (
        <ContextMenu
          items={openSubmenuItem.children}
          position={openSubmenu.position}
          submenu
          width={width}
          onClose={onClose}
          onMenuMouseEnter={cancelCloseTimer}
          onMenuMouseLeave={() => scheduleCloseSubmenu()}
        />
      )}
    </>,
    document.body,
  );
}
