import type { ReportRef } from "../ReportView/ReportRefList";
import type { ReportBlock } from "@argus/remote-protocol";
import type { ReactNode } from "react";
import { Markdown } from "../Markdown/Markdown";
import { ReportView } from "../ReportView/ReportView";
import styles from "./AutomationRunView.module.css";

export interface RunReportProps {
  /** The run is still going, so an empty report is "not yet" rather than "never". */
  active: boolean;
  /** Structured blocks; preferred over the markdown when there are any. */
  blocks: ReportBlock[] | null;
  markdown: string | null;
  onOpenLink?: (href: string) => void;
  renderMarkdown?: (text: string, className: string) => ReactNode;
  resolveProposal?: (id: string) => ReportRef | null;
  resolveSession?: (id: string) => ReportRef | null;
}

/**
 * A structured report renders as Peacock blocks; anything else — including
 * every report written before blocks existed — stays markdown.
 */
export function RunReport({
  active,
  blocks,
  markdown,
  onOpenLink,
  renderMarkdown,
  resolveProposal,
  resolveSession,
}: RunReportProps) {
  const render =
    renderMarkdown ??
    ((text: string, className: string) => (
      <Markdown className={className} text={text} />
    ));

  if (blocks && blocks.length > 0) {
    return (
      <ReportView
        blocks={blocks}
        className={styles.report}
        renderMarkdown={(text) => render(text, styles.markdown)}
        resolveProposal={resolveProposal}
        resolveSession={resolveSession}
        onOpenLink={onOpenLink}
      />
    );
  }
  if (markdown && markdown.trim() !== "") {
    return <>{render(markdown, styles.markdown)}</>;
  }

  return (
    <p className={styles.pending}>
      {active
        ? "The agent is still working. The report lands here when it finishes."
        : "This run produced no report."}
    </p>
  );
}
