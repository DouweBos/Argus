import { useEffect, useRef } from "react";
import styles from "./ModelPicker.module.css";

interface ModelPickerProps {
  currentModel: string | undefined;
  models: string[];
  onClose: () => void;
  onSelect: (model: string) => void;
}

export function ModelPicker({
  models,
  currentModel,
  onSelect,
  onClose,
}: ModelPickerProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  return (
    <div className={styles.picker} ref={ref}>
      <div className={styles.header}>Switch model</div>
      {models.map((model) => (
        <button
          key={model}
          className={`${styles.option} ${model === currentModel ? styles.optionActive : ""}`}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(model);
          }}
        >
          <span className={styles.optionName}>{model}</span>
          {model === currentModel && (
            <span className={styles.optionCheck}>✓</span>
          )}
        </button>
      ))}
    </div>
  );
}
