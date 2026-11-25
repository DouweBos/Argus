import { describe, expect, it } from "vitest";
import { dutyReportPrompt, reportText } from "./dutyReports";

const run = {
  error: null,
  report_blocks: null,
  report_markdown: null,
  status: "succeeded" as const,
};

describe("dutyReportPrompt", () => {
  it("hands over the report for the teammate to tell in its own words", () => {
    const prompt = dutyReportPrompt(
      { name: "Review requested" },
      { ...run, report_markdown: "Verdict: request changes" },
    );
    expect(prompt).toContain('duty "Review requested" just finished');
    expect(prompt).toContain("<report>\nVerdict: request changes\n</report>");
  });

  it("says nothing for a run without a report, or one that didn't finish", () => {
    expect(dutyReportPrompt({ name: "x" }, run)).toBeNull();
    expect(
      dutyReportPrompt({ name: "x" }, { ...run, status: "cancelled" }),
    ).toBeNull();
  });

  it("passes on why a run failed", () => {
    const prompt = dutyReportPrompt(
      { name: "Fix my red CI" },
      { ...run, status: "failed", error: "rate limited" },
    );
    expect(prompt).toContain("just failed: rate limited");
  });
});

describe("reportText", () => {
  it("prefers the blocks over the markdown", () => {
    const text = reportText({
      report_markdown: "one line",
      report_blocks: [
        { type: "heading", text: "Draft review" },
        { type: "stats", items: [{ label: "Blocking comments", value: "3" }] },
        { type: "table", columns: ["#", "File"], rows: [[1, "a.ts"]] },
        { type: "list", items: [{ text: "Add a test" }] },
      ],
    });
    expect(text).toBe(
      "## Draft review\n\nBlocking comments: 3\n\n# | File\n1 | a.ts\n\n- Add a test",
    );
  });
});
