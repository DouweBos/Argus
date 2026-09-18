/**
 * The boundary: a model's report is either a valid block document or markdown.
 * Nothing in between renders — a malformed block must never reach the UI.
 */

import { describe, expect, it } from "vitest";
import { ReportBlock, ReportDocument } from "@argus/remote-protocol";
import { renderedReport } from "./report";

const HEADING = { type: "heading", text: "Yesterday" };

describe("reportBlock validation", () => {
  it("accepts every block type", () => {
    const blocks = [
      HEADING,
      { type: "markdown", text: "**hi**" },
      { type: "stats", items: [{ label: "Merged", value: "7", delta: 3 }] },
      { type: "table", columns: ["Repo", "PRs"], rows: [["argus", 6]] },
      { type: "list", items: [{ text: "green", tone: "positive" }] },
      { type: "series", kind: "bar", labels: ["Mon"], values: [4] },
      { type: "proposals", ids: ["p-1"] },
      { type: "sessions", ids: ["s-1"] },
    ];
    for (const block of blocks) {
      expect(ReportBlock.safeParse(block).success).toBe(true);
    }
  });

  it("rejects an unknown block type", () => {
    expect(
      ReportBlock.safeParse({ type: "html", text: "<b>no</b>" }).success,
    ).toBe(false);
  });

  it("rejects a series whose labels and values disagree", () => {
    const bad = { type: "series", kind: "bar", labels: ["a"], values: [1, 2] };
    expect(ReportBlock.safeParse(bad).success).toBe(false);
  });

  it("rejects a table row that does not match its columns", () => {
    const bad = { type: "table", columns: ["a", "b"], rows: [["only"]] };
    expect(ReportBlock.safeParse(bad).success).toBe(false);
  });

  it("rejects a stats item missing its value", () => {
    const bad = { type: "stats", items: [{ label: "Merged" }] };
    expect(ReportBlock.safeParse(bad).success).toBe(false);
  });

  it("rejects a document whose blocks are not an array", () => {
    expect(ReportDocument.safeParse({ blocks: HEADING }).success).toBe(false);
  });
});

describe("renderedReport", () => {
  it("renders a plain markdown report as markdown", () => {
    const report = renderedReport("## Standup\n\n- one\n- two");
    expect(report.kind).toBe("markdown");
  });

  it("renders a bare json document as blocks", () => {
    const report = renderedReport(JSON.stringify({ blocks: [HEADING] }));
    expect(report).toStrictEqual({ kind: "blocks", blocks: [HEADING] });
  });

  it("renders a bare json array as blocks", () => {
    const report = renderedReport(JSON.stringify([HEADING]));
    expect(report).toStrictEqual({ kind: "blocks", blocks: [HEADING] });
  });

  it("renders a fenced argus-report as blocks", () => {
    const text = `Here you go:\n\n\`\`\`argus-report\n${JSON.stringify({
      blocks: [HEADING],
    })}\n\`\`\`\n`;
    expect(renderedReport(text)).toStrictEqual({
      kind: "blocks",
      blocks: [HEADING],
    });
  });

  it("falls back to markdown when a block is malformed", () => {
    const text = JSON.stringify({
      blocks: [
        HEADING,
        { type: "series", kind: "pie", labels: [], values: [] },
      ],
    });
    expect(renderedReport(text).kind).toBe("markdown");
  });

  it("leaves an unrelated json code fence as markdown", () => {
    const text = 'Config:\n\n```json\n{ "blocks": [] }\n```\n';
    expect(renderedReport(text).kind).toBe("markdown");
  });

  it("treats a missing or blank report as empty", () => {
    expect(renderedReport(null).kind).toBe("empty");
    expect(renderedReport("   ").kind).toBe("empty");
  });
});
