import type { ClaudeUsageLimits } from "@argus/remote-protocol";
import { describe, expect, it } from "vitest";
import { agentLimitsView, runnerHasLimits } from "./agentLimits";

const window = {
  id: "five_hour",
  kind: "session" as const,
  label: "Session",
  used_percent: 40,
  resets_at: null,
  window_minutes: 300,
  pace: null,
};

const limits: ClaudeUsageLimits = {
  accounts: [
    {
      account_id: "a",
      label: "Work",
      status: "ok",
      subscription_type: "max",
      windows: [window],
      checked_at: 0,
    },
    {
      account_id: "b",
      label: "Home",
      status: "ok",
      subscription_type: "pro",
      windows: [window],
      checked_at: 0,
    },
  ],
  runners: [
    {
      runner: "codex",
      label: "Codex",
      status: "ok",
      plan: "plus",
      message: null,
      windows: [window],
      checked_at: 0,
    },
    {
      runner: "grok",
      label: "Grok",
      status: "unsupported",
      plan: null,
      message: null,
      windows: [],
      checked_at: 0,
    },
  ],
};

describe("agent limits", () => {
  it("offers the command by what the host can read before it answers", () => {
    expect(runnerHasLimits(null, undefined)).toBe(true);
    expect(runnerHasLimits(null, "codex")).toBe(true);
    expect(runnerHasLimits(null, "custom:apex")).toBe(false);
    expect(runnerHasLimits(limits, "grok")).toBe(false);
    expect(runnerHasLimits(limits, "codex")).toBe(true);
  });

  it("pools Claude Code's accounts and picks a runner's own windows", () => {
    const claude = agentLimitsView(limits, "claude-code", 0);
    expect(claude?.title).toBe("Claude Code");
    expect(claude?.pools?.[0]?.value).toBe("60% left");
    const codex = agentLimitsView(limits, "codex", 0);
    expect(codex).toMatchObject({ title: "Codex", pools: null });
    expect(codex?.accounts[0]?.windows[0]?.value).toBe("60% left");
    expect(agentLimitsView(limits, "cursor", 0)).toBeNull();
  });
});
