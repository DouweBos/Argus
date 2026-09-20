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
  openQuickRuns,
  useAutomation,
  useAutomationRun,
} from "../../../stores/automationStore";
import { selectSession, useSessions } from "../../../stores/sessionStore";
import { CancelRunButton, RunStatusBadge } from "../RunControls";
import { SaveQuickRunButton } from "../SaveQuickRunButton";
import styles from "./AutomationRunScreen.module.css";
import { RunReport } from "./RunReport";
import { useReportRefResolvers } from "./reportRefs";

/**
 * One firing, and what it wrote — at `/automations/:automationId/runs/:runId`
 * for a scheduled run, and at `/automations/quick/runs/:runId` for an ad-hoc
 * one. An ad-hoc run has no automation to hang off, so its name and its way
 * back both come from the spec on the run itself.
 */
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
            <Button
              size="sm"
              onClick={() =>
                automationId ? openAutomation(automationId) : openQuickRuns()
              }
            >
              {automationId ? "Back to the automation" : "Back to quick runs"}
            </Button>
          }
        />
      </div>
    );
  }

  const report = renderedReport(run.report_markdown, run.report_blocks);
  const hostSession = run.host_session_id
    ? (sessions.find((s) => s.id === run.host_session_id) ?? null)
    : null;
  const active = isRunActive(run);
  const scratch = run.scratch;
  const backLabel = scratch ? "Quick runs" : (automation?.name ?? "Automation");

  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <button
          type="button"
          className={styles.back}
          onClick={() =>
            automationId ? openAutomation(automationId) : openQuickRuns()
          }
        >
          <Icons.ChevronLeftIcon size={12} />
          {backLabel}
        </button>
        <span className={styles.spacer} />
        {scratch && !active && <SaveQuickRunButton runId={run.id} />}
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
        <span className={styles.reason}>
          {scratch
            ? `${run.trigger_reason} · ${scratch.name}`
            : run.trigger_reason}
        </span>
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
