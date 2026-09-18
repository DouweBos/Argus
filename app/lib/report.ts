/**
 * How a run's report gets rendered: as structured blocks when the agent emitted
 * a valid report document, as plain markdown otherwise. Reports written before
 * the block union existed keep rendering exactly as they did.
 */

import { type ReportBlock, parseReportBlocks } from "@argus/remote-protocol";

export type RenderedReport =
  | { blocks: ReportBlock[]; kind: "blocks" }
  | { kind: "empty" }
  | { kind: "markdown"; text: string };

export function renderedReport(text: string | null): RenderedReport {
  if (!text || text.trim() === "") {
    return { kind: "empty" };
  }
  const blocks = parseReportBlocks(text);
  if (blocks) {
    return { blocks, kind: "blocks" };
  }

  return { kind: "markdown", text };
}
