import type { ReactNode } from "react";
import styles from "./StartHeading.module.css";

export interface StartHeadingProps {
  /** The project it starts in; without one the question stands alone. */
  project?: ReactNode;
  /** A quiet line under it: the session, or another way to start. */
  subtitle?: ReactNode;
}

/** The question over a new agent's composer, as the Mac asks it. */
export function StartHeading({ project, subtitle }: StartHeadingProps) {
  return (
    <div className={styles.heading}>
      <h2 className={styles.title}>
        {project ? (
          <>
            What should we build in{" "}
            <span className={styles.project}>{project}</span>?
          </>
        ) : (
          "What should we build?"
        )}
      </h2>
      {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
    </div>
  );
}
