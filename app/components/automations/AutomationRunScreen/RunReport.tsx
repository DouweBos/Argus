import type { RenderedReport } from "../../../lib/report";
import { type ReportRef, RunReport as Report } from "@argus/peacock";
import { openExternalUrl } from "../../../lib/ipc";
import { Markdown } from "../../shared/Markdown";

export interface RunReportProps {
  /** The run is still going, so an empty report is "not yet" not "never". */
  active: boolean;
  report: RenderedReport;
  resolveProposal?: (id: string) => ReportRef | null;
  resolveSession?: (id: string) => ReportRef | null;
}

/** Peacock's report, fed the desktop's parse of the run's final message. */
export function RunReport({
  active,
  report,
  resolveProposal,
  resolveSession,
}: RunReportProps) {
  return (
    <Report
      active={active}
      blocks={report.kind === "blocks" ? report.blocks : null}
      markdown={report.kind === "markdown" ? report.text : null}
      renderMarkdown={(text, className) => (
        <Markdown className={className} text={text} />
      )}
      resolveProposal={resolveProposal}
      resolveSession={resolveSession}
      onOpenLink={(href) => {
        openExternalUrl(href).catch(() => undefined);
      }}
    />
  );
}
