import { CloseIcon } from "../../icons/Icons";
import styles from "./FilterChip.module.css";

export interface FilterChipProps {
  field: string;
  /** "is", "is not", "contains"… — clicking it flips the filter when `onOperatorClick` is set. */
  operator: string;
  onOperatorClick?: () => void;
  /** Opens the filter's values to change them. */
  onClick?: () => void;
  onRemove: () => void;
  /** Already summarized: "High, Urgent" or "3 labels". */
  value: string;
}

/** One active filter in a filter bar: field · operator · values · remove. */
export function FilterChip({
  field,
  operator,
  onOperatorClick,
  onClick,
  onRemove,
  value,
}: FilterChipProps) {
  return (
    <span className={styles.chip}>
      <span className={styles.part}>{field}</span>
      <button
        className={styles.operator}
        disabled={!onOperatorClick}
        title={onOperatorClick ? "Switch between is and is not" : undefined}
        type="button"
        onClick={onOperatorClick}
      >
        {operator}
      </button>
      <button className={styles.value} type="button" onClick={onClick}>
        {value}
      </button>
      <button
        aria-label={`Remove ${field} filter`}
        className={styles.remove}
        type="button"
        onClick={onRemove}
      >
        <CloseIcon size={9} />
      </button>
    </span>
  );
}
