import { useEffect } from "react";
import {
  Button,
  EmptyState,
  FeedItem,
  Icons,
  WarningIcon,
} from "@argus/peacock";
import {
  clearNotifications,
  dismissNotification,
  markNotificationsSeen,
  type Notification,
  useNotifications,
} from "../../../../stores/notificationsStore";
import styles from "./NotificationsTool.module.css";

function relativeTime(ts: number): string {
  const delta = Date.now() - ts;
  const sec = Math.floor(delta / 1000);
  if (sec < 5) {
    return "just now";
  }
  if (sec < 60) {
    return `${sec}s`;
  }
  const min = Math.floor(sec / 60);
  if (min < 60) {
    return `${min}m`;
  }
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    return `${hr}h`;
  }
  const day = Math.floor(hr / 24);

  return `${day}d`;
}

function NotificationRow({ entry }: { entry: Notification }) {
  return (
    <FeedItem
      icon={<WarningIcon size={13} />}
      tone={entry.level === "error" ? "error" : "warning"}
      bordered
      chips={
        <>
          <span className={styles.levelChip}>{entry.level}</span>
          {entry.source && (
            <span className={styles.sourceChip}>{entry.source}</span>
          )}
        </>
      }
      title={entry.message}
      time={relativeTime(entry.timestamp)}
      trailing={
        <button
          className={styles.dismiss}
          title="Dismiss"
          onClick={() => dismissNotification(entry.id)}
        >
          <Icons.CloseIcon size={10} />
        </button>
      }
    />
  );
}

export function NotificationsTool() {
  const entries = useNotifications();

  useEffect(() => {
    markNotificationsSeen();
  }, [entries]);

  const errorCount = entries.filter((e) => e.level === "error").length;
  const warningCount = entries.length - errorCount;

  return (
    <div className={styles.tool}>
      <div className={styles.bar}>
        <span className={styles.summary}>
          {entries.length === 0
            ? "Everything looks clear"
            : `${errorCount} error${errorCount === 1 ? "" : "s"} · ${warningCount} warning${warningCount === 1 ? "" : "s"}`}
        </span>
        <div className={styles.spacer} />
        {entries.length > 0 && (
          <Button size="sm" variant="ghost" onClick={clearNotifications}>
            Clear all
          </Button>
        )}
      </div>

      {entries.length === 0 ? (
        <EmptyState
          icon={<WarningIcon size={20} />}
          title="No warnings or errors"
          body="Errors from background operations (workspace creation, merges, agent starts) will collect here so they don't interrupt your flow."
        />
      ) : (
        <div className={styles.list}>
          {entries.map((entry) => (
            <NotificationRow key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
