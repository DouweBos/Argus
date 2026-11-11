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

  it("reads tool calls from stream lines, subagents' included", () => {
    const { g } = gate();
    const line = (name: string, input: unknown, parent: string | null) =>
      JSON.stringify({
        type: "assistant",
        parent_tool_use_id: parent,
        message: { content: [{ type: "tool_use", id: "t", name, input }] },
      });
    g.observeLine(line("Bash", shot, "task-1"));
    g.observeLine(line("Edit", edit, null));
    expect(g.onStop(false)).not.toBeNull();
  });
});
