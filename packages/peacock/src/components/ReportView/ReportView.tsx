import type { ReportBlock } from "@argus/remote-protocol";
import type { ReactNode } from "react";
import { Markdown } from "../Markdown/Markdown";
import { SeriesChart } from "../SeriesChart/SeriesChart";
import { ReportHeading } from "./ReportHeading";
import { ReportList } from "./ReportList";
import { type ReportRef, ReportRefList } from "./ReportRefList";
import { ReportStats } from "./ReportStats";
import { ReportTable } from "./ReportTable";
import styles from "./ReportView.module.css";

export interface ReportViewProps {
  blocks: ReportBlock[];
  className?: string;
  /** Intercepts a link in a `list` block. */
  onOpenLink?: (href: string) => void;
  /** Overrides markdown rendering — desktop injects file-path linkification. */
  renderMarkdown?: (text: string) => ReactNode;
  /** Resolves a `proposals` id against current state. */
  resolveProposal?: (id: string) => ReportRef | null;
  /** Resolves a `sessions` id against current state. */
  resolveSession?: (id: string) => ReportRef | null;
}

/**
 * Renders a structured report. The model picks structure and data; every pixel
 * comes from here, so a report can never smuggle in markup or a colour.
 */
export function ReportView({
  blocks,
  className,
  onOpenLink,
  renderMarkdown,
  resolveProposal,
  resolveSession,
}: ReportViewProps) {
  return (
    <div className={[styles.report, className].filter(Boolean).join(" ")}>
      {blocks.map((block, i) => (
        <div className={styles.block} key={i}>
          {renderBlock(block, {
            onOpenLink,
            renderMarkdown,
            resolveProposal,
            resolveSession,
          })}
        </div>
      ))}
    </div>
  );
}

type RenderOptions = Omit<ReportViewProps, "blocks" | "className">;

function renderBlock(block: ReportBlock, options: RenderOptions): ReactNode {
  switch (block.type) {
    case "heading":
      return <ReportHeading text={block.text} />;
    case "markdown":
      return options.renderMarkdown ? (
        options.renderMarkdown(block.text)
      ) : (
        <Markdown text={block.text} />
      );
    case "stats":
      return <ReportStats items={block.items} />;
    case "table":
      return <ReportTable columns={block.columns} rows={block.rows} />;
    case "list":
      return <ReportList items={block.items} onOpenLink={options.onOpenLink} />;
    case "series":
      return (
        <SeriesChart
          caption={block.label}
          kind={block.kind}
          labels={block.labels}
          values={block.values}
        />
      );
    case "proposals":
      return (
        <ReportRefList
          ids={block.ids}
          kind="proposal"
          resolve={options.resolveProposal}
        />
      );
    case "sessions":
      return (
        <ReportRefList
          ids={block.ids}
          kind="session"
          resolve={options.resolveSession}
        />
      );
  }
}
