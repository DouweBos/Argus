import { ProgressBar } from "../ProgressBar/ProgressBar";
import styles from "./UsageSummary.module.css";

export interface BreakdownRow {
  id: string;
  name: string;
  detail?: string;
  cost: string;
  share: string;
  tokens: string;
  progress: number;
  priced: boolean;
}

/** Rows of name, cost, share and tokens; buttons when `onSelect` is given. */
export function Breakdown({
  heading,
  rows,
  unpricedTitle,
  note,
  onSelect,
}: {
  heading: string;
  rows: BreakdownRow[];
  /** Tooltip on an unpriced row's dash. */
  unpricedTitle: string;
  note?: string;
  onSelect?: (id: string) => void;
}) {
  return (
    <div className={styles.breakdown}>
      <div className={`${styles.row} ${styles.headRow}`}>
        <span>{heading}</span>
        <span className={styles.num}>Cost</span>
        <span className={styles.num}>Share</span>
        <span className={styles.num}>Tokens</span>
      </div>
      {rows.map((m) => {
        const cells = (
          <>
            <span className={styles.model}>
              <span className={styles.modelName}>
                {m.name}
                {m.detail && (
                  <span className={styles.detail}> · {m.detail}</span>
                )}
              </span>
              <ProgressBar
                aria-label={`${m.name} share`}
                progress={m.progress}
                size="xs"
              />
            </span>
            <span
              className={styles.num}
              title={m.priced ? undefined : unpricedTitle}
            >
              {m.cost}
            </span>
            <span className={styles.num}>{m.share}</span>
            <span className={styles.num}>{m.tokens}</span>
          </>
        );

        return onSelect ? (
          <button
            className={`${styles.row} ${styles.rowButton}`}
            key={m.id}
            type="button"
            onClick={() => onSelect(m.id)}
          >
            {cells}
          </button>
        ) : (
          <div className={styles.row} key={m.id}>
            {cells}
          </div>
        );
      })}
      {note && <p className={styles.note}>{note}</p>}
    </div>
  );
}
