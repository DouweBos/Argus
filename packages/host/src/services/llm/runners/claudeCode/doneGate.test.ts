import { describe, expect, it } from "vitest";
import { classifyToolUse, DoneGate, isEvidenceCommand } from "./doneGate";

function gate(enabled = true) {
  const reports: boolean[] = [];
  const g = new DoneGate({
    enabled: () => enabled,
    report: (r) => reports.push(r),
  });

  return { g, reports };
}

const edit = { file_path: "/w/src/App.tsx" };
const shot = { command: "conductor take-screenshot --device web" };

describe("classifyToolUse", () => {
  it("counts source edits but not docs, changesets or plans", () => {
    expect(classifyToolUse("Edit", edit)).toBe("edit");
    expect(classifyToolUse("Write", { file_path: "/w/README.md" })).toBeNull();
    expect(
      classifyToolUse("Write", { file_path: "/w/.changeset/a.md" }),
    ).toBeNull();
    expect(classifyToolUse("Edit", { file_path: "/w/plan/x.ts" })).toBeNull();
    expect(
      classifyToolUse("NotebookEdit", { notebook_path: "/w/a.ipynb" }),
    ).toBe("edit");
  });

  it("counts design_compare and evidence commands", () => {
    expect(classifyToolUse("mcp__argus__design_compare", {})).toBe("evidence");
    expect(classifyToolUse("Bash", shot)).toBe("evidence");
    expect(classifyToolUse("Bash", { command: "ls" })).toBeNull();
    expect(classifyToolUse("Read", edit)).toBeNull();
  });
});

describe("isEvidenceCommand", () => {
  it.each([
    "conductor capture-ui --device booted",
    "conductor inspect",
    "cd pkg && pnpm test",
    "pnpm -F @argus/host test -- doneGate",
    "npm run lint",
    "pnpm typecheck",
    "npx tsc --noEmit",
    "CI=1 vitest run",
    "swift test",
    "xcodebuild -scheme X test",
    "yarn test:e2e",
  ])("%s is evidence", (cmd) => expect(isEvidenceCommand(cmd)).toBe(true));

  it.each([
    "git log --grep test",
    "conductor tap-on Login",
    "pnpm install",
    "cat test.ts",
    "xcodebuild -scheme X build",
  ])("%s is not", (cmd) => expect(isEvidenceCommand(cmd)).toBe(false));
});

describe("done gate", () => {
  it("stays unarmed for an agent that never gathered evidence", () => {
    const { g } = gate();
    g.observeToolUse("Edit", edit);
    expect(g.onStop(false)).toBeNull();
  });

  it("lets an agent stop when its evidence is newer than its edits", () => {
    const { g } = gate();
    g.observeToolUse("Edit", edit);
    g.observeToolUse("Bash", shot);
    expect(g.onStop(false)).toBeNull();
  });

  it("blocks once per turn when edits came after the evidence", () => {
    const { g, reports } = gate();
    g.observeToolUse("Bash", shot);
    g.observeToolUse("Edit", edit);
    expect(g.onStop(false)).toContain("App.tsx");
    // Second stop in the same turn always goes through, and resolves the block.
    expect(g.onStop(true)).toBeNull();
    expect(reports).toEqual([false]);
    g.observeToolUse("Edit", edit);
    expect(g.onStop(false)).toBeNull();
  });

  it("reports a re-verification after the block", () => {
    const { g, reports } = gate();
    g.observeToolUse("Bash", shot);
    g.observeToolUse("Edit", edit);
    g.onStop(false);
    g.observeToolUse("mcp__argus__design_compare", {});
    g.onStop(true);
    expect(reports).toEqual([true]);
  });

  it("respects stop_hook_active and blocks again on a new turn", () => {
    const { g } = gate();
    g.observeToolUse("Bash", shot);
    g.observeToolUse("Edit", edit);
    expect(g.onStop(true)).toBeNull();
    g.newTurn();
    expect(g.onStop(false)).not.toBeNull();
  });

  it("never blocks while the setting is off", () => {
    const { g } = gate(false);
    g.observeToolUse("Bash", shot);
    g.observeToolUse("Edit", edit);
    expect(g.onStop(false)).toBeNull();
  });

  it("reads tool calls from stream lines; a subagent's evidence arms it", () => {
    const { g } = gate();
    g.observeLine(line("Bash", shot, "task-1"));
    g.observeLine(line("Edit", edit, null));
    expect(g.onStop(false)).not.toBeNull();
  });
});

function line(
  name: string,
  input: Record<string, unknown>,
  parent: string | null,
  id = "t",
) {
  return JSON.stringify({
    type: "assistant",
    parent_tool_use_id: parent,
    message: { content: [{ type: "tool_use", id, name, input }] },
  });
}

const result = (id: string) =>
  JSON.stringify({
    type: "user",
    parent_tool_use_id: null,
    message: { content: [{ type: "tool_result", tool_use_id: id }] },
  });

const settled = (id: string) =>
  JSON.stringify({
    type: "system",
    subtype: "task_notification",
    task_id: "x",
    tool_use_id: id,
    status: "completed",
  });

const subEdit = { file_path: "/w/src/implementTicketTool.ts" };

/** Main verified, then launched a background subagent `bg-1`. */
function withBackgroundSubagent() {
  const t = gate();
  t.g.observeLine(line("Bash", shot, null));
  t.g.observeLine(
    line("Agent", { prompt: "p", run_in_background: true }, null, "bg-1"),
  );
  // The launch's tool_result only says it started.
  t.g.observeLine(result("bg-1"));

  return t;
}

describe("done gate with subagents", () => {
  it("ignores edits by a subagent still running", () => {
    const { g } = withBackgroundSubagent();
    g.observeLine(line("Write", subEdit, "bg-1"));
    expect(g.onStop(false)).toBeNull();
  });

  it("lets a finished subagent's own evidence cover its edits", () => {
    const { g } = withBackgroundSubagent();
    g.observeLine(line("Write", subEdit, "bg-1"));
    g.observeLine(line("Bash", { command: "pnpm test" }, "bg-1"));
    g.observeLine(settled("bg-1"));
    expect(g.onStop(false)).toBeNull();
  });

  it("blocks on a finished subagent's unverified edits until re-verified", () => {
    const { g, reports } = withBackgroundSubagent();
    g.observeLine(line("Write", subEdit, "bg-1"));
    expect(g.onStop(false)).toBeNull();
    g.newTurn();
    g.observeLine(settled("bg-1"));
    expect(g.onStop(false)).toContain("implementTicketTool.ts");
    g.observeLine(line("Bash", shot, null));
    g.onStop(true);
    expect(reports).toEqual([true]);
  });

  it("needs evidence after the subagent finished, not before", () => {
    const { g } = withBackgroundSubagent();
    g.observeLine(line("Write", subEdit, "bg-1"));
    g.observeLine(line("Bash", shot, null));
    g.observeLine(settled("bg-1"));
    expect(g.onStop(false)).not.toBeNull();
  });

  it("counts a foreground subagent when its call returns", () => {
    const { g } = gate();
    g.observeLine(line("Bash", shot, null));
    g.observeLine(line("Agent", { prompt: "p" }, null, "fg-1"));
    g.observeLine(line("Edit", subEdit, "fg-1"));
    g.observeLine(result("fg-1"));
    expect(g.onStop(false)).toContain("implementTicketTool.ts");
  });

  it("lets a subagent's checks cover the main agent's earlier edits", () => {
    const { g } = gate();
    g.observeLine(line("Bash", shot, null));
    g.observeLine(line("Edit", edit, null));
    g.observeLine(line("Agent", { prompt: "verify" }, null, "fg-1"));
    g.observeLine(line("Bash", { command: "pnpm test" }, "fg-1"));
    g.observeLine(result("fg-1"));
    expect(g.onStop(false)).toBeNull();
  });

  it("still blocks the main agent's own edits while a subagent runs", () => {
    const { g } = withBackgroundSubagent();
    g.observeLine(line("Write", subEdit, "bg-1"));
    g.observeLine(line("Edit", edit, null));
    const reason = g.onStop(false);
    expect(reason).toContain("App.tsx");
    expect(reason).not.toContain("implementTicketTool.ts");
  });
});
