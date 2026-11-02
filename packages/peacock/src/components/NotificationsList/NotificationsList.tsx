import { CloseIcon, WarningIcon } from "../../icons/Icons";
import { Button } from "../Button/Button";
import { EmptyState } from "../EmptyState/EmptyState";
import { FeedItem } from "../FeedItem/FeedItem";
import styles from "./NotificationsList.module.css";

/** One entry, from `notificationRows` in `@argus/client-core`. */
export interface NotificationRowData {
  id: string;
  level: "error" | "warning";
  message: string;
  source: string | null;
  /** How many times in a row it happened; shown as ×N past one. */
  count: number;
  /** "5m", "just now". */
  time: string;
}

export interface NotificationsListProps {
  entries: NotificationRowData[];
  /** "2 errors · 1 warning". */
  summary: string;
  onDismiss: (id: string) => void;
  onClearAll: () => void;
  /** Hide the heading when the surrounding chrome already names the screen. */
  hideTitle?: boolean;
  /** What collects here, said when nothing has. */
  emptyBody?: string;
}

/** Warnings and errors kept so a toast that vanished unread can still be read. */
export function NotificationsList({
  entries,
  summary,
  onDismiss,
  onClearAll,
  hideTitle = false,
  emptyBody = "Errors from background operations (workspace creation, merges, agent starts) will collect here so they don't interrupt your flow.",
}: NotificationsListProps) {
  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        {!hideTitle && (
          <span className={styles.titleHeading}>Warnings &amp; errors</span>
        )}
        <span className={styles.sub}>{summary}</span>
        <div className={styles.spacer} />
        {entries.length > 0 && (
          <Button variant="ghost" onClick={onClearAll}>
            Clear all
          </Button>
        )}
      </div>

      {entries.length === 0 ? (
        <EmptyState
          icon={<WarningIcon size={20} />}
          title="No warnings or errors"
          body={emptyBody}
        />
      ) : (
        <div className={styles.list}>
          {entries.map((entry) => (
            <FeedItem
              key={entry.id}
              icon={<WarningIcon size={13} />}
              tone={entry.level === "error" ? "error" : "warning"}
              bordered
              chips={
                <>
                  <span className={styles.levelChip}>{entry.level}</span>
                  {entry.source && (
                    <span className={styles.sourceChip}>{entry.source}</span>
                  )}
                  {entry.count > 1 && (
                    <span className={styles.count}>×{String(entry.count)}</span>
                  )}
                </>
              }
              title={entry.message}
              time={entry.time}
              trailing={
                <button
                  type="button"
                  className={styles.dismiss}
                  title="Dismiss"
                  aria-label="Dismiss"
                  onClick={() => onDismiss(entry.id)}
                >
                  <CloseIcon size={10} />
                </button>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
