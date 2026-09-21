import type { AutomationRun } from "../../../lib/types";
import { Badge, Icons, InboxItemRow } from "@argus/peacock";
import { formatRelative } from "../../../lib/automations";
import {
  openAutomationRun,
  useAutomations,
} from "../../../stores/automationStore";
import styles from "./InboxScreen.module.css";

/** Runs that did not finish — the automation itself needs attention. */
export function FailedRuns({ runs }: { runs: AutomationRun[] }) {
  const automations = useAutomations();

  return (
    <div className={styles.rows}>
      {runs.map((run) => {
        const automation = automations.find((a) => a.id === run.automation_id);

        return (
          <InboxItemRow
            key={run.id}
            leading={<Icons.WarningIcon size={12} />}
            meta={<Badge tone="error">{formatRelative(run.started_at)}</Badge>}
            onOpen={() => openAutomationRun(run.automation_id, run.id)}
            subtitle={run.error ?? "No error recorded."}
            title={automation?.name ?? "Deleted automation"}
            tone="alert"
          />
        );
      })}
    </div>
  );
}
