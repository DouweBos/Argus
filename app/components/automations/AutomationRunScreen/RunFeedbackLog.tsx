import type { AutomationRunFeedback } from "../../../lib/types";
import { Badge } from "@argus/peacock";
import { formatTimestamp } from "../../../lib/automations";
import { Markdown } from "../../shared/Markdown";
import styles from "./RunFeedbackLog.module.css";

/**
 * What was argued with, in the user's own words. Kept on the run because a
 * corrected report that does not say what corrected it reads like the run
 * simply changed its mind.
 */
export function RunFeedbackLog({ notes }: { notes: AutomationRunFeedback[] }) {
  return (
    <ul className={styles.list}>
      {notes.map((note) => (
        <li className={styles.item} key={note.id}>
          <div className={styles.head}>
            <span className={styles.when}>
              {formatTimestamp(note.created_at)}
            </span>
            {note.allow_clearing && (
              <Badge tone="warning">could remove proposals</Badge>
            )}
          </div>
          <Markdown className={styles.note} text={note.note} />
        </li>
      ))}
    </ul>
  );
}
