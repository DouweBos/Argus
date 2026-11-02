import styles from "./CommitRow.module.css";

export interface CommitRowProps {
  subject: string;
  /** Full or short; the row shows the first 7 characters. */
  hash: string;
  author?: string | null;
  /** Already worded ("3h ago"); the caller owns the clock. */
  age?: string | null;
  /** Makes the row a button, e.g. to open the commit's diff. */
  onClick?: () => void;
}

/** One commit in a list: subject over its short hash, author and age. */
export function CommitRow({
  subject,
  hash,
  author,
  age,
  onClick,
}: CommitRowProps) {
  const body = (
    <>
      <span className={styles.subject} title={subject}>
        {subject}
      </span>
      <span className={styles.meta}>
        <span className={styles.hash}>{hash.slice(0, 7)}</span>
        {author && <span className={styles.author}>{author}</span>}
        {age && <span className={styles.age}>{age}</span>}
      </span>
    </>
  );

  if (!onClick) {
    return <div className={styles.row}>{body}</div>;
  }

  return (
    <button
      type="button"
      className={`${styles.row} ${styles.clickable}`}
      onClick={onClick}
    >
      {body}
    </button>
  );
}
