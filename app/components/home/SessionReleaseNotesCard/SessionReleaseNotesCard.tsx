import type { ReleaseNoteEntry } from "../../../lib/types";
import { Badge, Icons } from "@argus/peacock";
import styles from "./SessionReleaseNotesCard.module.css";

interface SessionReleaseNotesListProps {
  entries: ReleaseNoteEntry[];
  /** True while the changeset-validation agent is being dispatched. */
  isValidating?: boolean;
  /** Called when the user clicks the "Validate with agent" button. Only
   *  rendered when at least one entry has `format === "changesets"`. */
  onValidate?: () => void;
}

type BadgeTone = "accent" | "neutral" | "success" | "warning";

/**
 * Inline list of release-note files added or modified on this branch — for
 * embedding inside the Ready-to-merge card. The text content of each file
 * is rendered verbatim so the user can read what would ship on merge.
 */
export function SessionReleaseNotesList({
  entries,
  onValidate,
  isValidating,
}: SessionReleaseNotesListProps) {
  if (entries.length === 0) {
    return null;
  }

  const count = entries.length;
  const hasChangesets = entries.some((e) => e.format === "changesets");
  const headingNoun = hasChangesets ? "changeset" : "release note";

  return (
    <div className={styles.wrap}>
      <div className={styles.heading}>
        <div className={styles.headingLabel}>
          <Icons.FileIcon size={12} />
          <span>
            {`${count} ${headingNoun}${count === 1 ? "" : "s"} ready to merge`}
          </span>
        </div>
        {hasChangesets && onValidate && (
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
        {entries.map((entry) => (
          <li className={styles.item} key={entry.filename}>
            <div className={styles.header}>
              <span className={styles.filename}>{entry.filename}</span>
              <div className={styles.badges}>
                {entry.labels.map((label, i) => (
                  <Badge
                    key={`${label.name}-${i}`}
                    size="tag"
                    tone={(label.tone ?? "neutral") as BadgeTone}
                  >
                    {label.name} · {label.value}
                  </Badge>
                ))}
                <Badge
                  size="tag"
                  tone={entry.status === "added" ? "success" : "accent"}
                >
                  {entry.status}
                </Badge>
              </div>
            </div>
            {entry.content ? (
              <pre className={styles.content}>{entry.content}</pre>
            ) : (
              <p className={styles.empty}>(empty file)</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
