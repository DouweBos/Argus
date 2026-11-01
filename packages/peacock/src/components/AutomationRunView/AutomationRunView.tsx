import { runStatusTone } from "@argus/client-core";
import type {
  RemoteAutomationRunStatus,
  RemoteRunFeedback,
} from "@argus/remote-protocol";
import type { ReactNode } from "react";
import { Badge } from "../Badge/Badge";
import { SectionPanel } from "../SectionPanel/SectionPanel";
import { StatCell, StatsStrip } from "../StatsStrip/StatsStrip";
import styles from "./AutomationRunView.module.css";
import { RunFeedbackLog } from "./RunFeedbackLog";

export function RunStatusBadge({
  status,
}: {
  status: RemoteAutomationRunStatus;
}) {
  return <Badge tone={runStatusTone(status)}>{status}</Badge>;
}

export interface AutomationRunViewProps {
  status: RemoteAutomationRunStatus;
  /** When it started, formatted. */
  title: string;
  /** Why it fired, and for a quick run its name. */
  reason: string;
  /** Header buttons: feedback, save as automation, open the agent, cancel or delete. */
  actions?: ReactNode;
  duration: string;
  cost: string;
  finished: string;
  /** The session it ran in, by name; omit where a client has no name for it. */
  session?: string;
  /** Counting up while it runs. */
  live?: boolean;
  error?: string | null;
  /** The report, usually a `RunReport`. */
  report: ReactNode;
  feedback?: RemoteRunFeedback[];
  renderMarkdown?: (text: string, className: string) => ReactNode;
}

/**
 * One firing, and what it wrote: status, what it cost, the report and what
 * was argued with since.
 */
export function AutomationRunView({
  actions,
  cost,
  duration,
  error,
  feedback = [],
  finished,
  live,
  reason,
  renderMarkdown,
  report,
  session,
  status,
  title,
}: AutomationRunViewProps) {
  return (
    <div className={styles.view}>
      {actions && <header className={styles.head}>{actions}</header>}

      <div className={styles.titleBlock}>
        <RunStatusBadge status={status} />
        <h1 className={styles.title}>{title}</h1>
        <span className={styles.reason}>{reason}</span>
      </div>

      <StatsStrip>
        <StatCell label="Duration" live={live} value={duration} />
        <StatCell label="Cost" value={cost} />
        <StatCell label="Finished" value={finished} />
        {session !== undefined && <StatCell label="Session" value={session} />}
      </StatsStrip>

      {error && <p className={styles.error}>{error}</p>}

      <SectionPanel title="Report">{report}</SectionPanel>

      {feedback.length > 0 && (
        <SectionPanel title="Feedback">
          <RunFeedbackLog notes={feedback} renderMarkdown={renderMarkdown} />
        </SectionPanel>
      )}
    </div>
  );
}
