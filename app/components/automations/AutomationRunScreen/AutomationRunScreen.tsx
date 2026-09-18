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
import { renderedReport } from "../../../lib/report";
import { useCurrentRoute } from "../../../lib/routeHooks";
import {
  openAutomation,
  useAutomation,
  useAutomationRun,
} from "../../../stores/automationStore";
import { selectSession, useSessions } from "../../../stores/sessionStore";
import { CancelRunButton, RunStatusBadge } from "../RunControls";
import styles from "./AutomationRunScreen.module.css";
import { RunReport } from "./RunReport";
import { useReportRefResolvers } from "./reportRefs";

/** `/automations/:automationId/runs/:runId` — one firing, and what it wrote. */
export function AutomationRunScreen() {
  const { automationId, automationRunId } = useCurrentRoute();
  const automation = useAutomation(automationId);
  const run = useAutomationRun(automationRunId);
  const sessions = useSessions();
  const { resolveProposal, resolveSession } = useReportRefResolvers();

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

  const report = renderedReport(run.report_markdown);
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
        <RunReport
          active={active}
          report={report}
          resolveProposal={resolveProposal}
          resolveSession={resolveSession}
        />
      </SectionPanel>
    </div>
  );
}
