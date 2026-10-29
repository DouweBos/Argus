import type { LinearIssueDetail } from "../../../lib/types";
import { Avatar, IssueStatusIcon } from "@argus/peacock";
import { shortDuration, timeInStatus } from "@argus/remote-protocol";
import { ago, lastChange } from "../../../lib/issueActivity";
import styles from "./IssuePropertyCards.module.css";

/** Linear's "Time in status": every status the issue sat in, and for how long. */
export function TimeInStatusCard({ issue }: { issue: LinearIssueDetail }) {
  const stints = timeInStatus(issue.statusHistory ?? []);

  return (
    <>
      <span className={styles.title}>Time in status</span>
      {stints.length === 0 ? (
        <span className={styles.muted}>No status changes yet.</span>
      ) : (
        stints.map((s) => (
          <div key={s.name} className={styles.row}>
            <IssueStatusIcon type={s.type} />
            <span className={styles.name}>{s.name}</span>
            <span className={styles.muted}>{shortDuration(s.duration)}</span>
          </div>
        ))
      )}
    </>
  );
}

/** Who last changed a property, and when. */
export function LastChangeCard({
  issue,
  kind,
  title,
}: {
  issue: LinearIssueDetail;
  kind: "priority";
  title: string;
}) {
  const change = lastChange(issue, kind);

  return (
    <>
      <span className={styles.title}>{title}</span>
      {change ? (
        <div className={styles.row}>
          {change.actor && (
            <Avatar name={change.actor} size={16} src={change.actorAvatarUrl} />
          )}
          <span className={styles.name}>
            {change.actor ?? "Linear"} {change.text}
          </span>
          <span className={styles.muted}>{ago(change.createdAt)}</span>
        </div>
      ) : (
        <span className={styles.muted}>Never changed.</span>
      )}
    </>
  );
}
