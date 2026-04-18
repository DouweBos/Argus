import { useEffect, useRef } from "react";
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
}

export function ModelPicker({
  models,
  currentModel,
  onSelect,
  onClose,
}: ModelPickerProps) {
  const ref = useRef<HTMLDivElement>(null);

  useOutsideClick(ref, true, onClose);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleEscape);

    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  return (
    <div ref={ref} className={styles.picker}>
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
    </div>
  );
}
