/**
 * `/notifications`: warnings and errors from this visit, so a failure that
 * flashed past can still be read. Kept in this tab only.
 */

import { useEffect } from "react";
import { notificationRows, notificationsSummary } from "@argus/client-core";
import { NotificationsList } from "@argus/peacock";
import { useNotificationsStore } from "../stores/notifications";
import { capture } from "../telemetry/telemetry";

export function NotificationsView() {
  const entries = useNotificationsStore((s) => s.entries);
  const markSeen = useNotificationsStore((s) => s.markSeen);
  const dismiss = useNotificationsStore((s) => s.dismiss);
  const clear = useNotificationsStore((s) => s.clear);

  useEffect(() => {
    capture("web_notifications_opened", {
      count: useNotificationsStore.getState().entries.length,
    });
  }, []);
  // Anything arriving while the list is open has been seen.
  useEffect(() => markSeen(), [entries, markSeen]);

  return (
    <div className="aw-flush">
      <NotificationsList
        hideTitle
        emptyBody="Failures shown while you use Argus here are kept until you close the tab."
        entries={notificationRows(entries, Date.now())}
        summary={notificationsSummary(entries)}
        onClearAll={() => {
          clear();
          capture("web_notifications_cleared", { scope: "all" });
        }}
        onDismiss={(id) => {
          dismiss(id);
          capture("web_notifications_cleared", { scope: "one" });
        }}
      />
    </div>
  );
}
