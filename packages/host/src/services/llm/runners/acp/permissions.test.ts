import type { AcpToolCall } from "./protocol";
import { describe, expect, it } from "vitest";
import { acpVerdict, pickOption } from "./permissions";

const ctx = { cwd: "/work", disallowed: [] as string[], toolName: "Bash" };
const run: AcpToolCall = {
  toolCallId: "1",
  kind: "execute",
  rawInput: { command: "git push origin" },
};
const editIn: AcpToolCall = {
  toolCallId: "2",
  kind: "edit",
  locations: [{ path: "/work/src/a.ts" }],
};
const editOut: AcpToolCall = {
  toolCallId: "3",
  kind: "edit",
  locations: [{ path: "/etc/hosts" }],
};
const read: AcpToolCall = { toolCallId: "4", kind: "read" };

describe("acpVerdict", () => {
  it.each([
    ["ask", run, "ask"],
    ["ask", read, "ask"],
    ["review", read, "allow"],
    ["review", editIn, "allow"],
    ["review", editOut, "ask"],
    ["review", run, "ask"],
    ["auto", run, "allow"],
    ["auto", editIn, "allow"],
    ["auto", editOut, "ask"],
    ["plan", read, "allow"],
    ["plan", editIn, "deny"],
    ["plan", run, "deny"],
    ["trusted", editOut, "allow"],
  ] as const)("%s mode: %o → %s", (mode, call, verdict) => {
    expect(acpVerdict(mode, call, ctx)).toBe(verdict);
  });

  it("refuses a disallowed command in any mode, and asks before other commands", () => {
    const guarded = { ...ctx, disallowed: ["Bash(git push:*)"] };
    expect(acpVerdict("trusted", run, guarded)).toBe("deny");
    const ls = { ...run, rawInput: { command: "ls" } };
    expect(acpVerdict("trusted", ls, guarded)).toBe("ask");
    expect(acpVerdict("auto", ls, guarded)).toBe("ask");
  });

  it("refuses edits when the guard disallows them", () => {
    const guarded = { ...ctx, disallowed: ["Edit"], toolName: "Edit" };
    expect(acpVerdict("trusted", editIn, guarded)).toBe("deny");
  });

  it("treats a path that climbs out of the worktree as outside", () => {
    const sneaky = { ...editIn, locations: [{ path: "/work/../etc/x" }] };
    expect(acpVerdict("review", sneaky, ctx)).toBe("ask");
  });
});

describe("pickOption", () => {
  const options = [
    { optionId: "once", name: "", kind: "allow_once" as const },
    { optionId: "always", name: "", kind: "allow_always" as const },
    { optionId: "no", name: "", kind: "reject_once" as const },
  ];

  it("prefers one-off approvals unless always was asked for", () => {
    expect(pickOption(options, "allow", false)).toBe("once");
    expect(pickOption(options, "allow", true)).toBe("always");
    expect(pickOption(options, "deny", false)).toBe("no");
    expect(pickOption([options[0]!], "deny", false)).toBeNull();
  });
});
