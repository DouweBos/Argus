import { useEffect, useState } from "react";
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
  isUnreadReport,
} from "../../../lib/automations";
import { renderedReport } from "../../../lib/report";
import { useCurrentRoute } from "../../../lib/routeHooks";
import {
  markRunRead,
  openAutomation,
  openQuickRuns,
  useAutomationRun,
} from "../../../stores/automationStore";
import { selectSession, useSessions } from "../../../stores/sessionStore";
import {
  CancelRunButton,
  DeleteRunButton,
  RunStatusBadge,
} from "../RunControls";
import { RunFeedbackDialog } from "../RunFeedbackDialog";
import { SaveQuickRunButton } from "../SaveQuickRunButton";
import styles from "./AutomationRunScreen.module.css";
import { RunFeedbackLog } from "./RunFeedbackLog";
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
  const run = useAutomationRun(automationRunId);
  const sessions = useSessions();
  const { resolveProposal, resolveSession } = useReportRefResolvers();
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // Opening the run is reading its report, so home stops flagging it.
  const unread = run !== null && isUnreadReport(run);
  const runId = run?.id ?? null;
  useEffect(() => {
    if (runId && unread) {
      markRunRead(runId);
    }
  }, [runId, unread]);

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
  const feedback = run.feedback ?? [];
  // Nothing to resume once the session is gone — a deleted run takes it with it.
  const canGiveFeedback = !active && run.host_session_id !== null;

  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <span className={styles.spacer} />
        {canGiveFeedback && (
          <Button
            size="sm"
            variant="secondary"
            leading={<Icons.ChatIcon size={11} />}
            onClick={() => setFeedbackOpen(true)}
          >
            Give feedback
          </Button>
        )}
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
        {active ? (
          <CancelRunButton runId={run.id} />
        ) : (
          <DeleteRunButton
            onDeleted={() =>
              scratch ? openQuickRuns() : openAutomation(run.automation_id)
            }
            runId={run.id}
          />
        )}
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

      {feedback.length > 0 && (
        <SectionPanel title="Feedback">
          <RunFeedbackLog notes={feedback} />
        </SectionPanel>
      )}

      {feedbackOpen && (
        <RunFeedbackDialog
          runId={run.id}
          onClose={() => setFeedbackOpen(false)}
        />
      )}
    </div>
  );
}
