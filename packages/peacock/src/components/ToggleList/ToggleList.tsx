import { Toggle } from "../Toggle/Toggle";
import styles from "./ToggleList.module.css";

export interface ToggleListOption {
  id: string;
  label: string;
  /** Muted trailing note: "not configured", "not open on this computer". */
  hint?: string;
}

export interface ToggleListProps {
  options: ToggleListOption[];
  /** The ids switched on. */
  selection: string[];
  onChange: (selection: string[]) => void;
  emptyMessage: string;
  disabled?: boolean;
}

/**
 * Pick any number of a short list — projects a run may read, the sources
 * that feed it — one switch per row. ArgusUI's `ToggleList`.
 */
export function ToggleList({
  disabled,
  emptyMessage,
  onChange,
  options,
  selection,
}: ToggleListProps) {
  if (options.length === 0) {
    return <p className={styles.empty}>{emptyMessage}</p>;
  }

  return (
    <ul className={styles.list}>
      {options.map((option) => {
        const on = selection.includes(option.id);

        return (
          <li className={styles.row} key={option.id}>
            <Toggle
              checked={on}
              disabled={disabled}
              size="sm"
              onChange={(checked) =>
                onChange(
                  checked
                    ? [...selection, option.id]
                    : selection.filter((id) => id !== option.id),
                )
              }
            >
              <span className={styles.label}>{option.label}</span>
              {option.hint && (
                <span className={styles.hint}>{option.hint}</span>
              )}
            </Toggle>
          </li>
        );
      })}
    </ul>
  );
}
