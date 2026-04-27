import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useOutsideClick } from "../../../hooks/useOutsideClick";
import styles from "./ModelPicker.module.css";

export interface ModelOption {
  /** Optional short description shown below the name. */
  description?: string;
  /** Display label shown in the picker. */
  displayName: string;
  /** The model identifier sent to the CLI (e.g. "claude-opus-4-6"). */
  value: string;
}

interface ModelPickerProps {
  currentModel: string | undefined;
  models: ModelOption[];
  onClose: () => void;
  onSelect: (modelValue: string) => void;
  /** Element the picker should anchor to. Picker opens above and aligned to its left. */
  triggerRef: RefObject<HTMLElement | null>;
}

interface PickerRect {
  bottom: number;
  left: number;
}

export function ModelPicker({
  models,
  currentModel,
  onSelect,
  onClose,
  triggerRef,
}: ModelPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<PickerRect | null>(null);

  useLayoutEffect(() => {
    const updateRect = () => {
      const node = triggerRef.current;
      if (!node) {
        return;
      }
      const r = node.getBoundingClientRect();
      setRect({ left: r.left, bottom: window.innerHeight - r.top + 6 });
    };

    updateRect();
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);

    return () => {
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  }, [triggerRef]);

  useOutsideClick(ref, true, onClose, (target) => {
    return triggerRef.current?.contains(target) ?? false;
  });

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
      <div className={styles.header}>Switch model</div>
      {models.map((model) => {
        const isActive = model.value === currentModel;

        return (
          <button
            key={model.value}
            className={`${styles.option} ${isActive ? styles.optionActive : ""}`}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(model.value);
            }}
          >
            <div className={styles.optionLabel}>
              <span className={styles.optionName}>{model.displayName}</span>
              {model.description && (
                <span className={styles.optionDesc}>{model.description}</span>
              )}
            </div>
            {isActive && <span className={styles.optionCheck}>✓</span>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
