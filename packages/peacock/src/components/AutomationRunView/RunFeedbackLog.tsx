import { formatTimestamp } from "@argus/client-core";
import type { RemoteRunFeedback } from "@argus/remote-protocol";
import type { ReactNode } from "react";
import { Badge } from "../Badge/Badge";
import { Markdown } from "../Markdown/Markdown";
import styles from "./AutomationRunView.module.css";

/**
 * What was argued with, in the user's own words. Kept on the run because a
 * corrected report that does not say what corrected it reads like the run
 * simply changed its mind.
 */
export function RunFeedbackLog({
  notes,
  renderMarkdown,
}: {
  notes: RemoteRunFeedback[];
  renderMarkdown?: (text: string, className: string) => ReactNode;
}) {
  return (
    <ul className={styles.feedback}>
      {notes.map((note) => (
        <li className={styles.feedbackItem} key={note.id}>
          <div className={styles.feedbackHead}>
            <span className={styles.when}>
              {formatTimestamp(note.created_at)}
            </span>
            {note.allow_clearing && (
              <Badge tone="warning">could remove proposals</Badge>
            )}
          </div>
          {renderMarkdown ? (
            renderMarkdown(note.note, styles.note)
          ) : (
            <Markdown className={styles.note} text={note.note} />
          )}
        </li>
      ))}
    </ul>
  );
}
