import type { LinearHistoryEvent } from "@argus/remote-protocol";
import { Avatar } from "../Avatar/Avatar";
import { IssueStatusIcon } from "../IssueStatusIcon/IssueStatusIcon";
import styles from "./IssuePropertyCards.module.css";

/** One status the issue sat in, and for how long ("5d"). */
export interface IssueStatusStint {
  duration: string;
  name: string;
  type: string;
}

/** Linear's "Time in status": every status the issue sat in, and for how long. */
export function TimeInStatusCard({ stints }: { stints: IssueStatusStint[] }) {
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
            <span className={styles.muted}>{s.duration}</span>
          </div>
        ))
      )}
    </>
  );
}

/** Who last changed a property, and when. */
export function LastChangeCard({
  ago,
  change,
  title,
}: {
  ago: (epochMs: number) => string;
  change: LinearHistoryEvent | null;
  title: string;
}) {
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
