import type { AgentSession } from "./models";
import type { LimitHandoffAccount } from "@argus/remote-protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rows: [] as LimitHandoffAccount[],
  enabled: true,
  handoff: vi.fn(() => Promise.resolve()),
  capture: vi.fn(),
}));

vi.mock("./limitHandoff", () => ({
  limitHandoffAccounts: () => Promise.resolve(h.rows),
}));
vi.mock("./accountSwitch", () => ({ handoffAgentToAccount: h.handoff }));
vi.mock("./busy", () => ({ isAgentBusy: () => false }));
vi.mock("../session/argusConfig", () => ({
  loadArgusConfig: () => ({ auto_switch_account_on_limit: h.enabled }),
}));
vi.mock("../telemetry/telemetry", () => ({ capture: h.capture }));

const { appState } = await import("../../state");
const { autoSwitchOnLimit, pickAutoSwitchAccount } =
  await import("./limitAutoSwitch");

function row(id: string, used: number | null): LimitHandoffAccount {
  return {
    account_id: id,
    label: id,
    detail: null,
    usage:
      used === null
        ? null
        : { label: "Session", used_percent: used, resets_at: null },
  } as LimitHandoffAccount;
}

function addAgent(runner = "claude-code"): void {
  appState.sessions.set("s1", { id: "s1", repo_root: "/repo" } as never);
  appState.agents.set("a1", {
    agentId: "a1",
    sessionId: "s1",
    status: "idle",
    runner: { id: runner },
    turnWaiters: [],
  } as unknown as AgentSession);
}

describe("limitAutoSwitch", () => {
  beforeEach(() => {
    appState.agents.clear();
    appState.sessions.clear();
    h.rows = [];
    h.enabled = true;
    h.handoff.mockClear();
    h.capture.mockClear();
  });

  describe("pickAutoSwitchAccount", () => {
    it("picks the account with the lowest usage", () => {
      const pick = pickAutoSwitchAccount([
        row("work", 60),
        row("spare", 10),
        row("other", 35),
      ]);
      expect(pick?.account_id).toBe("spare");
    });

    it("skips accounts whose usage couldn't be read", () => {
      expect(pickAutoSwitchAccount([row("unknown", null)])).toBeNull();
      expect(
        pickAutoSwitchAccount([row("unknown", null), row("work", 80)])
          ?.account_id,
      ).toBe("work");
    });
  });

  describe("autoSwitchOnLimit", () => {
    it("moves the agent to the least used account", async () => {
      addAgent();
      h.rows = [row("work", 70), row("spare", 5)];
      await autoSwitchOnLimit("a1");
      expect(h.handoff).toHaveBeenCalledWith("a1", "spare", "auto_limit");
      expect(h.capture).toHaveBeenCalledWith("agent_limit_auto_switch", {
        outcome: "switched",
      });
    });

    it("does nothing when the project hasn't turned it on", async () => {
      addAgent();
      h.enabled = false;
      h.rows = [row("spare", 5)];
      await autoSwitchOnLimit("a1");
      expect(h.handoff).not.toHaveBeenCalled();
    });

    it("never switches a runner other than Claude Code", async () => {
      addAgent("codex");
      h.rows = [row("spare", 5)];
      await autoSwitchOnLimit("a1");
      expect(h.handoff).not.toHaveBeenCalled();
    });

    it("reports when no account can take over", async () => {
      addAgent();
      await autoSwitchOnLimit("a1");
      expect(h.handoff).not.toHaveBeenCalled();
      expect(h.capture).toHaveBeenCalledWith("agent_limit_auto_switch", {
        outcome: "no_account",
      });
    });
  });
});
