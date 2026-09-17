import {
  Button,
  EmptyState,
  Icons,
  SectionPanel,
  StatCell,
  StatsStrip,
} from "@argus/peacock";
import {
  formatCost,
  formatDuration,
  formatTimestamp,
  isRunActive,
} from "../../../lib/automations";
import { useCurrentRoute } from "../../../lib/routeHooks";
import {
  openAutomation,
  useAutomation,
  useAutomationRun,
} from "../../../stores/automationStore";
import { selectSession, useSessions } from "../../../stores/sessionStore";
import { Markdown } from "../../shared/Markdown";
import { CancelRunButton, RunStatusBadge } from "../RunControls";
import styles from "./AutomationRunScreen.module.css";

/** `/automations/:automationId/runs/:runId` — one firing, and what it wrote. */
export function AutomationRunScreen() {
  const { automationId, automationRunId } = useCurrentRoute();
  const automation = useAutomation(automationId);
  const run = useAutomationRun(automationRunId);
  const sessions = useSessions();

  if (!run) {
    return (
      <div className={styles.screen}>
        <EmptyState
          title="Run not found"
          body="Runs are pruned once an automation has fifty of them."
          action={
            automationId ? (
              <Button size="sm" onClick={() => openAutomation(automationId)}>
                Back to the automation
              </Button>
            ) : null
          }
        />
      </div>
    );
  }

  const hostSession = run.host_session_id
    ? (sessions.find((s) => s.id === run.host_session_id) ?? null)
    : null;
  const active = isRunActive(run);

  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <button
          type="button"
          className={styles.back}
          onClick={() => automationId && openAutomation(automationId)}
        >
          <Icons.ChevronLeftIcon size={12} />
          {automation?.name ?? "Automation"}
        </button>
        <span className={styles.spacer} />
        {hostSession && (
          <Button
            size="sm"
            variant="secondary"
            leading={<Icons.AgentIcon size={11} />}
            onClick={() => selectSession(hostSession.id)}
          >
            Open transcript
          </Button>
        )}
        {active && <CancelRunButton runId={run.id} />}
      </header>

      <div className={styles.titleBlock}>
        <RunStatusBadge status={run.status} />
        <h1 className={styles.titleHeading}>
          {formatTimestamp(run.started_at)}
        </h1>
        <span className={styles.reason}>{run.trigger_reason}</span>
      </div>

      <StatsStrip>
        <StatCell label="Duration" value={formatDuration(run)} live={active} />
        <StatCell label="Cost" value={formatCost(run.cost_usd)} />
        <StatCell
          label="Finished"
          value={run.finished_at ? formatTimestamp(run.finished_at) : "—"}
        />
        <StatCell
          label="Host session"
          value={
            hostSession ? (hostSession.display_name ?? hostSession.branch) : "—"
          }
        />
      </StatsStrip>

      {run.error && <p className={styles.error}>{run.error}</p>}

      <SectionPanel title="Report">
        {run.report_markdown ? (
          <Markdown className={styles.markdown} text={run.report_markdown} />
        ) : (
          <p className={styles.pending}>
            {active
              ? "The agent is still working. The report lands here when it finishes."
              : "This run produced no report."}
          </p>
        )}
      </SectionPanel>
    </div>
  );
}
