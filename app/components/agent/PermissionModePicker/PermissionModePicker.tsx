import {
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useOutsideClick } from "../../../hooks/useOutsideClick";
import {
  type CanonicalPermissionMode,
  PERMISSION_MODE_OPTIONS,
} from "../../../lib/permissionModes";
import styles from "./PermissionModePicker.module.css";

interface PermissionModePickerProps {
  currentMode: CanonicalPermissionMode;
  onClose: () => void;
  onSelect: (mode: CanonicalPermissionMode) => void;
  /** Element the picker should anchor to. Picker opens above and aligned to its left. */
  triggerRef: RefObject<HTMLElement | null>;
}

interface PickerRect {
  bottom: number;
  left: number;
}

export function PermissionModePicker({
  currentMode,
  onSelect,
  onClose,
  triggerRef,
}: PermissionModePickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<PickerRect | null>(null);

  useLayoutEffect(() => {
    const update = () => {
      const node = triggerRef.current;
      if (!node) {
        return;
      }
      const r = node.getBoundingClientRect();
      setRect({ left: r.left, bottom: window.innerHeight - r.top + 6 });
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);

    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [triggerRef]);

  useOutsideClick(
    ref,
    true,
    onClose,
    (target) => triggerRef.current?.contains(target) ?? false,
  );

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleEscape);

    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  if (!rect) {
    return null;
  }

  return createPortal(
    <div
      ref={ref}
      className={styles.picker}
      style={{ left: rect.left, bottom: rect.bottom }}
    >
      <div className={styles.header}>Permission mode</div>
      {PERMISSION_MODE_OPTIONS.map((opt) => {
        const isActive = opt.value === currentMode;

        return (
          <button
            key={opt.value}
            className={`${styles.option} ${isActive ? styles.optionActive : ""}`}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(opt.value);
            }}
          >
            <div className={styles.optionLabel}>
              <span className={styles.optionName}>{opt.displayName}</span>
              <span className={styles.optionDesc}>{opt.description}</span>
            </div>
            {isActive && <span className={styles.optionCheck}>✓</span>}
          </button>
        );
      })}
      <div className={styles.footer}>
        <kbd className={styles.kbd}>⇧</kbd>
        <kbd className={styles.kbd}>Tab</kbd>
        <span>to cycle modes</span>
      </div>
    </div>,
    document.body,
  );
}
