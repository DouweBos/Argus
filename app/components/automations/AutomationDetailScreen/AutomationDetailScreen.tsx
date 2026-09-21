import type { AutomationRun } from "../../../lib/types";
import {
  Button,
  EmptyState,
  RunHistoryRow,
  SectionPanel,
  Toggle,
} from "@argus/peacock";
import {
  formatCost,
  formatDuration,
  formatTimestamp,
  isRunActive,
  isUnreadReport,
  nextRunLabel,
  triggerLabel,
} from "../../../lib/automations";
import { useCurrentRoute } from "../../../lib/routeHooks";
import {
  deleteAutomation,
  openAutomationRun,
  openAutomations,
  setAutomationEnabled,
  useAutomation,
  useAutomationRuns,
  useHasActiveRun,
} from "../../../stores/automationStore";
import { AutomationEditor } from "../AutomationEditor/AutomationEditor";
import { AutomationTrackRecord } from "../AutomationTrackRecord";
import {
  CancelRunButton,
  RunStatusBadge,
  TriggerRunButton,
} from "../RunControls";
import styles from "./AutomationDetailScreen.module.css";

function HistoryRow({
  automationId,
  run,
}: {
  automationId: string;
  run: AutomationRun;
}) {
  return (
    <RunHistoryRow
      status={<RunStatusBadge status={run.status} />}
      startedAt={formatTimestamp(run.started_at)}
      triggerReason={run.trigger_reason}
      duration={formatDuration(run)}
      cost={formatCost(run.cost_usd)}
      error={run.error ?? undefined}
      unread={isUnreadReport(run)}
      onClick={() => openAutomationRun(automationId, run.id)}
      actions={isRunActive(run) ? <CancelRunButton runId={run.id} /> : null}
    />
  );
}

/** `/automations/:automationId` — what it does, and every time it has run. */
export function AutomationDetailScreen() {
  const { automationId } = useCurrentRoute();
  const automation = useAutomation(automationId);
  const runs = useAutomationRuns(automationId);
  const active = useHasActiveRun(automationId ?? "");

  if (!automation) {
    return (
      <div className={styles.screen}>
        <EmptyState
          title="Automation not found"
          body="It may have been deleted on the host this window is reading from."
          action={
            <Button size="sm" onClick={() => openAutomations()}>
              Back to automations
            </Button>
          }
        />
      </div>
    );
  }

  const activeRun = runs.find(isRunActive) ?? null;

  const remove = async () => {
    try {
      await deleteAutomation(automation.id);
      openAutomations();
    } catch {
      // Nothing to do — the list is still correct.
    }
  };

  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <span className={styles.spacer} />
        <Toggle
          checked={automation.enabled}
          onChange={(enabled) => {
            setAutomationEnabled(automation.id, enabled).catch(() => undefined);
          }}
        >
          {automation.enabled ? "Enabled" : "Paused"}
        </Toggle>
        {active && activeRun ? (
          <CancelRunButton runId={activeRun.id} />
        ) : (
          <TriggerRunButton automationId={automation.id} />
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            remove().catch(() => undefined);
          }}
        >
          Delete
        </Button>
      </header>

      <div className={styles.titleBlock}>
        <h1 className={styles.titleHeading}>{automation.name}</h1>
        <p className={styles.meta}>
          {triggerLabel(automation.trigger)} · next {nextRunLabel(automation)}
        </p>
      </div>

      <AutomationTrackRecord
        automationId={automation.id}
        refreshKey={runs.length}
      />

      <AutomationEditor key={automation.id} automation={automation} />

      <SectionPanel
        title="Run history"
        meta={`${runs.length} run${runs.length === 1 ? "" : "s"}`}
      >
        {runs.length === 0 ? (
          <p className={styles.empty}>
            This automation has never run. Press Run now to see what it does.
          </p>
        ) : (
          <div className={styles.runs}>
            {runs.map((run) => (
              <HistoryRow key={run.id} automationId={automation.id} run={run} />
            ))}
          </div>
        )}
      </SectionPanel>
    </div>
  );
}
