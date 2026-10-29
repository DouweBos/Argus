import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import styles from "./PickerPopover.module.css";

export interface PickerPopoverProps {
  children: ReactNode;
  /** Distance between the trigger and the popover. */
  gap?: number;
  onClose: () => void;
  /** Opens above the trigger by default; `below` for triggers near the top. */
  placement?: "above" | "below";
  /** Element the popover anchors to, aligned to its left edge. */
  triggerRef: RefObject<HTMLElement | null>;
}

interface Anchor {
  bottom?: number;
  top?: number;
  left: number;
  minWidth: number;
}

/**
 * Popover list anchored above a trigger — model, mode and project pickers all
 * sit in one. Portalled so a scrolling toolbar can't clip it, dismissed by a
 * pointer press outside or Escape.
 *
 * Selecting does not close it; the caller decides, so a multi-select list can
 * stay open.
 */
export function PickerPopover({
  children,
  gap = 6,
  onClose,
  placement = "above",
  triggerRef,
}: PickerPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  useLayoutEffect(() => {
    let frame = 0;

    const update = () => {
      const node = triggerRef.current;
      if (!node) {
        // A popover mounted already-open runs this before React attaches its
        // parent's ref. Retry next frame rather than render nothing forever.
        frame = requestAnimationFrame(update);

        return;
      }
      const r = node.getBoundingClientRect();
      setAnchor({
        // Keep the whole popover on screen on a narrow phone.
        left: Math.max(8, Math.min(r.left, window.innerWidth - 8 - r.width)),
        ...(placement === "below"
          ? { top: r.bottom + gap }
          : { bottom: window.innerHeight - r.top + gap }),
        minWidth: r.width,
      });
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [triggerRef, gap, placement]);

  // pointerdown, not mousedown: on touch a synthetic mousedown only arrives
  // after the finger lifts, which makes dismissal feel a beat late.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) {
        return;
      }
      if (
        ref.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return;
      }
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, triggerRef]);

  if (!anchor) {
    return null;
  }

  return createPortal(
    <div
      ref={ref}
      className={styles.popover}
      role="listbox"
      style={{
        left: anchor.left,
        bottom: anchor.bottom,
        top: anchor.top,
        minWidth: anchor.minWidth,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

function Header({ children }: { children: ReactNode }) {
  return <div className={styles.header}>{children}</div>;
}

export interface PickerOptionProps {
  /** Second line under the name. */
  description?: ReactNode;
  name: ReactNode;
  onSelect: () => void;
  selected?: boolean;
}

function Option({ description, name, onSelect, selected }: PickerOptionProps) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected ?? false}
      className={`${styles.option} ${selected ? styles.selected : ""}`}
      // mousedown, so a click never steals focus from the composer first.
      onMouseDown={(e) => {
        e.preventDefault();
        onSelect();
      }}
    >
      <span className={styles.label}>
        <span className={styles.name}>{name}</span>
        {description && (
          <span className={styles.description}>{description}</span>
        )}
      </span>
      {selected && <span className={styles.check}>✓</span>}
    </button>
  );
}

/** A row that states something without offering a choice. */
function Static({
  description,
  name,
}: {
  description?: ReactNode;
  name: ReactNode;
}) {
  return (
    <div className={styles.static}>
      <span className={styles.label}>
        <span className={styles.name}>{name}</span>
        {description && (
          <span className={styles.description}>{description}</span>
        )}
      </span>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className={styles.empty}>{children}</div>;
}

PickerPopover.Header = Header;
PickerPopover.Option = Option;
PickerPopover.Static = Static;
PickerPopover.Empty = Empty;
