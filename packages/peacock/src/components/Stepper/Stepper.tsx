import type { HTMLAttributes } from "react";
import styles from "./Stepper.module.css";

export interface StepperItem {
  id: string;
  label: string;
}

export interface StepperProps extends HTMLAttributes<HTMLOListElement> {
  steps: StepperItem[];
  currentIndex: number;
}

export function Stepper({
  steps,
  currentIndex,
  className,
  ...rest
}: StepperProps) {
  return (
    <ol
      className={[styles.stepper, className].filter(Boolean).join(" ")}
      {...rest}
    >
      {steps.map((step, i) => {
        let state: "complete" | "current" | "upcoming" = "upcoming";
        if (i < currentIndex) {
          state = "complete";
        } else if (i === currentIndex) {
          state = "current";
        }

        return (
          <li key={step.id} className={`${styles.item} ${styles[state]}`}>
            <span className={styles.bullet}>
              {i < currentIndex ? "✓" : i + 1}
            </span>
            <span className={styles.label}>{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
