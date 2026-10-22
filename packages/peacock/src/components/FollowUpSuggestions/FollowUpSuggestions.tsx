import { Kbd } from "../Kbd/Kbd";
import styles from "./FollowUpSuggestions.module.css";

export interface FollowUpSuggestionsProps {
  /** Replies the user might send next. Nothing renders when empty. */
  items: string[];
  onSelect: (index: number) => void;
  /** Mark the first item as the one Tab fills in. */
  tabHint?: boolean;
  className?: string;
}

/** A row of suggested replies above a chat input. */
export function FollowUpSuggestions({
  items,
  onSelect,
  tabHint = false,
  className,
}: FollowUpSuggestionsProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div
      aria-label="Suggested replies"
      className={[styles.row, className].filter(Boolean).join(" ")}
      role="group"
    >
      {items.map((item, i) => (
        <button
          key={item}
          className={styles.suggestion}
          title={item}
          type="button"
          onClick={() => onSelect(i)}
          // Keep focus (and the caret) in the input the suggestion fills.
          onMouseDown={(e) => e.preventDefault()}
        >
          <span className={styles.text}>{item}</span>
          {tabHint && i === 0 && <Kbd className={styles.kbd} keys={["Tab"]} />}
        </button>
      ))}
    </div>
  );
}

/**
 * The rest of the suggestion `value` is a prefix of, for ghost text after the
 * caret. Null when the input is empty, matches nothing, or already says it all.
 */
export function followUpCompletion(
  value: string,
  items: string[],
): string | null {
  if (!value.trim() || value.includes("\n")) {
    return null;
  }
  const lower = value.toLowerCase();
  const match = items.find(
    (item) =>
      item.length > value.length && item.toLowerCase().startsWith(lower),
  );

  return match ? match.slice(value.length) : null;
}
