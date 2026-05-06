import {
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useOutsideClick } from "../../../hooks/useOutsideClick";
import styles from "./EffortPicker.module.css";
import {
  EFFORT_LEVEL_DESCRIPTIONS,
  effortDisplayName,
  type EffortLevel,
} from "./effortLevels";

interface EffortPickerProps {
  /** Currently selected effort level, or `null` for the model default. */
  currentLevel: string | null;
  onClose: () => void;
  onSelect: (level: string | null) => void;
  /**
   * Effort levels supported by the active model — advertised by the runner
   * via `ModelInfo.supportedEffortLevels`. The picker hides if empty.
   */
  supportedLevels: string[];
  /** Element the picker should anchor to. Picker opens above and aligned to its left. */
  triggerRef: RefObject<HTMLElement | null>;
}

interface PickerRect {
  bottom: number;
  left: number;
}

export function EffortPicker({
  currentLevel,
  supportedLevels,
  onSelect,
  onClose,
  triggerRef,
}: EffortPickerProps) {
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

  const options: { description?: string; value: string | null }[] = [
    { value: null, description: "Use the model's default reasoning budget." },
    ...supportedLevels.map((level) => ({
      value: level,
      description:
        EFFORT_LEVEL_DESCRIPTIONS[level as EffortLevel] ??
        "Reasoning-effort level.",
    })),
  ];

  return createPortal(
    <div
      ref={ref}
      className={styles.picker}
      style={{ left: rect.left, bottom: rect.bottom }}
    >
      <div className={styles.header}>Reasoning effort</div>
      {options.map((opt) => {
        const isActive = (currentLevel ?? null) === opt.value;

        return (
          <button
            key={opt.value ?? "__default"}
            className={`${styles.option} ${isActive ? styles.optionActive : ""}`}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(opt.value);
            }}
          >
            <div className={styles.optionLabel}>
              <span className={styles.optionName}>
                {effortDisplayName(opt.value)}
              </span>
              {opt.description && (
                <span className={styles.optionDesc}>{opt.description}</span>
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
