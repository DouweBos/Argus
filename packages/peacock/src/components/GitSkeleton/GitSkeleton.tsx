import styles from "./GitSkeleton.module.css";

export type GitSkeletonVariant =
  | "branch-list"
  | "commit-log"
  | "diff"
  | "file-list"
  | "stash-list";

export interface GitSkeletonProps {
  variant: GitSkeletonVariant;
  /** Approximate row count to render. Defaults vary by variant. */
  rows?: number;
}

/**
 * Animated shimmer placeholder for git views. Pick a variant matching the
 * layout the real content will occupy so the swap doesn't reflow.
 */
export function GitSkeleton({ variant, rows }: GitSkeletonProps) {
  const count = rows ?? defaultRows(variant);

  return (
    <div className={styles.skeleton} aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <Row key={i} variant={variant} index={i} />
      ))}
    </div>
  );
}

function defaultRows(v: GitSkeletonVariant): number {
  switch (v) {
    case "diff":
      return 4;
    case "commit-log":
      return 8;
    case "file-list":
      return 6;
    case "stash-list":
      return 4;
    case "branch-list":
      return 6;
  }
}

function Row({
  variant,
  index,
}: {
  variant: GitSkeletonVariant;
  index: number;
}) {
  if (variant === "diff") {
    return <div className={[styles.bar, styles.diffBlock].join(" ")} />;
  }

  if (variant === "commit-log") {
    return (
      <div className={styles.commitRow}>
        <div className={[styles.bar, styles.dot].join(" ")} />
        <div className={[styles.bar, styles.line].join(" ")} />
        <div
          className={[styles.bar, styles.lineShort].join(" ")}
          style={{ width: 70 }}
        />
      </div>
    );
  }

  if (variant === "branch-list") {
    return (
      <div className={styles.row}>
        <div className={[styles.bar, styles.dot].join(" ")} />
        <div
          className={[
            styles.bar,
            index % 2 === 0 ? styles.lineMid : styles.line,
          ].join(" ")}
        />
      </div>
    );
  }

  // file-list / stash-list
  return (
    <div className={styles.row}>
      <div
        className={[
          styles.bar,
          index % 2 === 0 ? styles.line : styles.lineMid,
        ].join(" ")}
      />
    </div>
  );
}
