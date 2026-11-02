import { useEffect, useState } from "react";
import { notificationRows, notificationsSummary } from "@argus/client-core";
import { NotificationsList } from "@argus/peacock";
import {
  clearNotifications,
  dismissNotification,
  markNotificationsSeen,
  useNotifications,
} from "../../../stores/notificationsStore";

export function NotificationsScreen() {
  const entries = useNotifications();
  // A newer entry than `now` reads "just now"; the tick keeps older ones honest.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    markNotificationsSeen();
  }, [entries]);

  return (
    <NotificationsList
      entries={notificationRows(entries, now)}
      summary={notificationsSummary(entries)}
      onClearAll={clearNotifications}
      onDismiss={dismissNotification}
    />
  );
}
