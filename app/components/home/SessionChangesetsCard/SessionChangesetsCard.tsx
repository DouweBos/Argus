import type { ChangesetEntry } from "../../../lib/types";
import { Badge, Icons } from "@argus/peacock";
import styles from "./SessionChangesetsCard.module.css";

type BumpTone = "accent" | "success" | "warning";

function bumpTone(bump: string): BumpTone {
  const b = bump.toLowerCase();
  if (b === "major") {
    return "warning";
  }
  if (b === "minor") {
    return "accent";
  }

  return "success";
}

interface SessionChangesetsListProps {
  changesets: ChangesetEntry[];
  /** True while the validation agent is being dispatched. */
  isValidating?: boolean;
  /** Called when the user clicks the "Validate with agent" button. */
  onValidate?: () => void;
}

/** Inline list of pending changesets — for embedding inside another card. */
export function SessionChangesetsList({
  changesets,
  onValidate,
  isValidating,
}: SessionChangesetsListProps) {
  if (changesets.length === 0) {
    return null;
  }

  const count = changesets.length;

  return (
    <div className={styles.wrap}>
      <div className={styles.heading}>
        <div className={styles.headingLabel}>
          <Icons.FileIcon size={12} />
          <span>
            {`${count} changeset${count === 1 ? "" : "s"} ready to merge`}
          </span>
        </div>
        {onValidate && (
          <button
            className={styles.validateBtn}
            disabled={isValidating}
            title="Ask an agent to check each pending changeset describes work that actually lives on this branch, and delete any that are stale."
            type="button"
            onClick={onValidate}
          >
            <Icons.AgentStartIcon size={11} />
            {isValidating ? "Starting…" : "Validate with agent"}
          </button>
        )}
      </div>
      <ul className={styles.list}>
        {changesets.map((cs) => (
          <li className={styles.item} key={cs.filename}>
            <div className={styles.header}>
              <span className={styles.filename}>{cs.filename}</span>
              <div className={styles.bumps}>
                {cs.packages.map((p, i) => (
                  <Badge
                    key={`${p.name}-${i}`}
                    size="tag"
                    tone={bumpTone(p.bump)}
                  >
                    {p.name} · {p.bump}
                  </Badge>
                ))}
              </div>
            </div>
            {cs.summary ? (
              <p className={styles.summary}>{cs.summary}</p>
            ) : (
              <p className={styles.summaryEmpty}>No summary provided</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
