// @vitest-environment jsdom
/**
 * The retrofit contract: a structured report renders as blocks, a plain
 * markdown report keeps rendering as markdown, and a malformed one degrades to
 * markdown rather than to nothing.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderedReport } from "../../../lib/report";
import { RunReport } from "./RunReport";

function renderReport(text: string | null, active = false) {
  return render(<RunReport active={active} report={renderedReport(text)} />);
}

describe("runReport", () => {
  it("renders a plain markdown report as markdown", () => {
    renderReport("## Standup\n\nThree sessions merged.");
    expect(screen.getByRole("heading", { name: "Standup" })).toBeDefined();
    expect(screen.getByText("Three sessions merged.")).toBeDefined();
  });

  it("renders a structured report as blocks", () => {
    renderReport(
      JSON.stringify({
        blocks: [
          { type: "heading", text: "Yesterday" },
          { type: "stats", items: [{ label: "Merged", value: "7" }] },
          { type: "table", columns: ["Repo"], rows: [["argus"]] },
          { type: "series", kind: "bar", labels: ["Mon"], values: [4] },
        ],
      }),
    );
    expect(screen.getByRole("heading", { name: "Yesterday" })).toBeDefined();
    expect(screen.getByText("Merged")).toBeDefined();
    expect(screen.getByRole("columnheader", { name: "Repo" })).toBeDefined();
    expect(screen.getByRole("img")).toBeDefined();
  });

  it("renders unresolved live cards rather than a snapshot", () => {
    renderReport(
      JSON.stringify({ blocks: [{ type: "sessions", ids: ["x"] }] }),
    );
    expect(
      screen.getByText("This session is no longer available."),
    ).toBeDefined();
  });

  it("falls back to markdown when a block is malformed", () => {
    const text = JSON.stringify({
      blocks: [{ type: "series", kind: "pie", labels: [], values: [] }],
    });
    renderReport(text);
    expect(screen.getByText(text, { exact: false })).toBeDefined();
  });

  it("explains an empty report while the run is still going", () => {
    renderReport(null, true);
    expect(screen.getByText(/still working/)).toBeDefined();
  });

  it("explains an empty report once the run has finished", () => {
    renderReport("");
    expect(screen.getByText("This run produced no report.")).toBeDefined();
  });
});
