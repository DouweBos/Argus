import type { AutomationRun } from "../../../lib/types";
import { Badge, Button, Icons, InboxItemRow } from "@argus/peacock";
import { formatRelative, reportPreview } from "../../../lib/automations";
import {
  markRunRead,
  openAutomationRun,
  openQuickRun,
  useAutomations,
} from "../../../stores/automationStore";
import styles from "./InboxScreen.module.css";

/** Finished runs with a report nobody has opened yet. */
export function UnreadReports({ runs }: { runs: AutomationRun[] }) {
  const automations = useAutomations();

  return (
    <div className={styles.rows}>
      {runs.map((run) => {
        const automation = automations.find((a) => a.id === run.automation_id);

        return (
          <InboxItemRow
            actions={
              <Button
                onClick={() => markRunRead(run.id)}
                size="sm"
                variant="ghost"
              >
                Mark read
              </Button>
            }
            key={run.id}
            leading={<Icons.FileIcon size={12} />}
            meta={
              <Badge tone="neutral">{formatRelative(run.started_at)}</Badge>
            }
            onOpen={() =>
              run.scratch
                ? openQuickRun(run.id)
                : openAutomationRun(run.automation_id, run.id)
            }
            subtitle={reportPreview(run)}
            title={run.scratch?.name ?? automation?.name ?? "Quick run"}
          />
        );
      })}
    </div>
  );
}
