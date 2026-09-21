/**
 * How a run's report gets rendered: as structured blocks when the agent emitted
 * a valid report document, as plain markdown otherwise. Blocks published
 * through `emit_report` win; a report that only carries the agent's final
 * message still renders exactly as it did.
 */

import { type ReportBlock, parseReportBlocks } from "@argus/remote-protocol";

export type RenderedReport =
  | { blocks: ReportBlock[]; kind: "blocks" }
  | { kind: "empty" }
  | { kind: "markdown"; text: string };

export function renderedReport(
  text: string | null,
  blocks?: ReportBlock[] | null,
): RenderedReport {
  if (blocks && blocks.length > 0) {
    return { blocks, kind: "blocks" };
  }
  if (!text || text.trim() === "") {
    return { kind: "empty" };
  }
  const parsed = parseReportBlocks(text);
  if (parsed) {
    return { blocks: parsed, kind: "blocks" };
  }

  return { kind: "markdown", text };
}
