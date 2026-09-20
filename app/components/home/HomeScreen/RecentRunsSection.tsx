/**
 * The newest automation runs, across every automation and the quick runs.
 *
 * Runs are the one thing on this screen that happen while nobody is looking,
 * so home is where you find out they did. Scoped to the focused host — the
 * clock belongs to the machine that runs it.
 */

import type { Automation, AutomationRun } from "../../../lib/types";
import { RunHistoryRow } from "@argus/peacock";
import {
  formatCost,
  formatDuration,
  formatRelative,
} from "../../../lib/automations";
import {
  openAutomationRun,
  openAutomations,
  openQuickRun,
  useAllRuns,
  useAutomations,
} from "../../../stores/automationStore";
import { RunStatusBadge } from "../../automations/RunControls";
import styles from "./HomeScreen.module.css";

/** How many fit before the section starts competing with the rest of home. */
const LIMIT = 5;

/** A quick run has no automation behind it, so it names itself. */
function runName(run: AutomationRun, automations: Automation[]): string {
  if (run.scratch) {
    return run.scratch.name || "Quick run";
  }

  return (
    automations.find((a) => a.id === run.automation_id)?.name ?? "Automation"
  );
}

export function RecentRunsSection() {
  const runs = useAllRuns();
  const automations = useAutomations();

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.eyebrow}>Recent runs</span>
        <button
          type="button"
          className={styles.linkBtn}
          onClick={() => openAutomations()}
        >
          View all
        </button>
      </div>
      {runs.length === 0 ? (
        <div className={styles.emptyCell}>
          Nothing has run yet. Enable an automation, or try a quick run.
        </div>
      ) : (
        <div className={styles.rowList}>
          {runs.slice(0, LIMIT).map((run) => (
            <RunHistoryRow
              key={run.id}
              name={runName(run, automations)}
              status={<RunStatusBadge status={run.status} />}
              startedAt={formatRelative(run.started_at)}
              triggerReason={run.trigger_reason}
              duration={formatDuration(run)}
              cost={formatCost(run.cost_usd)}
              error={run.error ?? undefined}
              onClick={() => {
                if (run.scratch) {
                  openQuickRun(run.id);
                } else {
                  openAutomationRun(run.automation_id, run.id);
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
