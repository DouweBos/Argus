import type { RenderedReport } from "../../../lib/report";
import { type ReportRef, ReportView } from "@argus/peacock";
import { openExternalUrl } from "../../../lib/ipc";
import { Markdown } from "../../shared/Markdown";
import styles from "./AutomationRunScreen.module.css";

export interface RunReportProps {
  /** The run is still going, so an empty report is "not yet" not "never". */
  active: boolean;
  report: RenderedReport;
  resolveProposal?: (id: string) => ReportRef | null;
  resolveSession?: (id: string) => ReportRef | null;
}

/**
 * A structured report renders as Peacock blocks; anything else — including
 * every report written before the block union existed — stays markdown.
 */
export function RunReport({
  active,
  report,
  resolveProposal,
  resolveSession,
}: RunReportProps) {
  if (report.kind === "blocks") {
    return (
      <ReportView
        blocks={report.blocks}
        className={styles.report}
        onOpenLink={(href) => {
          openExternalUrl(href);
        }}
        renderMarkdown={(text) => (
          <Markdown className={styles.markdown} text={text} />
        )}
        resolveProposal={resolveProposal}
        resolveSession={resolveSession}
      />
    );
  }
  if (report.kind === "markdown") {
    return <Markdown className={styles.markdown} text={report.text} />;
  }

  return (
    <p className={styles.pending}>
      {active
        ? "The agent is still working. The report lands here when it finishes."
        : "This run produced no report."}
    </p>
  );
}
