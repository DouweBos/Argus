import { describe, expect, it } from "vitest";
import { matchesDisallowed } from "./disallowed";
import { toCodexPermissions } from "./permissionModes";

describe("toCodexPermissions", () => {
  it.each([
    ["ask", "untrusted", "read-only"],
    ["auto", "on-request", "workspace-write"],
    ["review", "untrusted", "workspace-write"],
    ["plan", "never", "read-only"],
    ["trusted", "never", "danger-full-access"],
    // Claude-native names from older callers.
    ["acceptEdits", "untrusted", "workspace-write"],
    ["bypassPermissions", "never", "danger-full-access"],
  ])("maps %s", (mode, approvalPolicy, sandbox) => {
    expect(toCodexPermissions(mode)).toEqual({ approvalPolicy, sandbox });
  });

  it("routes a guarded agent's commands through approval", () => {
    expect(toCodexPermissions("trusted", true)).toEqual({
      approvalPolicy: "untrusted",
      sandbox: "workspace-write",
    });
    expect(
      toCodexPermissions("auto", true, { editsDisallowed: true }).sandbox,
    ).toBe("read-only");
  });
});

describe("matchesDisallowed", () => {
  const rules = ["Bash(git push:*)", "Bash(git push*)", "Edit"];

  it("matches a denied command prefix", () => {
    expect(matchesDisallowed(rules, "Bash", "git push origin main")).toBe(true);
    expect(matchesDisallowed(rules, "Bash", "git status")).toBe(false);
  });

  it("matches a bare tool name", () => {
    expect(matchesDisallowed(rules, "Edit", null)).toBe(true);
    expect(matchesDisallowed(rules, "Write", null)).toBe(false);
  });
});
