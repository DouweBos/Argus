import { ThinkingDots } from "../ThinkingDots/ThinkingDots";
import styles from "./TypingIndicator.module.css";

export interface TypingIndicatorProps {
  /**
   * Who is typing. Zero names renders nothing, so a caller can pass the live
   * list straight through without guarding.
   */
  names?: string[];
  /**
   * Wording to use instead of the generated sentence — for a row that already
   * prints whose it is, where "Ana is typing" under "Ana" says it twice.
   */
  label?: string;
  className?: string;
}

/** Past two names the sentence stops growing, so a busy huddle stays one line. */
function phrase(names: string[]): string {
  if (names.length === 1) {
    return `${names[0]} is typing`;
  }
  if (names.length === 2) {
    return `${names[0]} and ${names[1]} are typing`;
  }

  return `${names[0]}, ${names[1]} and ${names.length - 2} others are typing`;
}

/**
 * Someone in a huddle is composing a message. Deliberately quiet — it sits
 * under a transcript that is already busy, so it is a few words and three
 * dots, never a banner that shifts the layout around it.
 *
 * The dots stand where the ellipsis would, and bounce: the one part of the
 * sentence still happening is the one part that moves.
 */
export function TypingIndicator({
  names = [],
  label,
  className,
}: TypingIndicatorProps) {
  const text = label ?? (names.length > 0 ? phrase(names) : null);
  if (!text) {
    return null;
  }

  return (
    <span
      aria-live="polite"
      className={[styles.root, className].filter(Boolean).join(" ")}
    >
      <span className={styles.label}>{text}</span>
      <ThinkingDots slow aria-label="Typing" />
    </span>
  );
}
