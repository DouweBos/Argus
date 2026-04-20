import type { ReactNode } from "react";
import styles from "./Coachmark.module.css";

export type CoachmarkPlacement = "bottom" | "left" | "right" | "top";

export interface CoachmarkProps {
  title: string;
  description?: string;
  placement?: CoachmarkPlacement;
  onNext?: () => void;
  onSkip?: () => void;
  nextLabel?: string;
  children?: ReactNode;
  /** Sequence position displayed in the corner (e.g. "1 / 3"). */
  progress?: string;
}

export function Coachmark({
  title,
  description,
  placement = "bottom",
  onNext,
  onSkip,
  nextLabel = "Got it",
  progress,
  children,
}: CoachmarkProps) {
  return (
    <div className={`${styles.coachmark} ${styles[placement]}`}>
      {progress ? <div className={styles.progress}>{progress}</div> : null}
      <div className={styles.title}>{title}</div>
      {description ? (
        <div className={styles.description}>{description}</div>
      ) : null}
      {children}
      <div className={styles.actions}>
        {onSkip ? (
          <button type="button" className={styles.skip} onClick={onSkip}>
            Skip tour
          </button>
        ) : null}
        {onNext ? (
          <button type="button" className={styles.next} onClick={onNext}>
            {nextLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
