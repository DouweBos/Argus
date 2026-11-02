import type { AgentSession } from "./models";
import type { ClaudeAccount } from "../claudeAuth/accounts";
import type { ClaudeAccountLimits } from "@argus/remote-protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  accounts: [] as ClaudeAccount[],
  limits: new Map<string, ClaudeAccountLimits>(),
  stalled: true,
  capture: vi.fn(),
  endStall: vi.fn(),
}));

vi.mock("../claudeAuth/accounts", () => ({
  listClaudeAccounts: () => h.accounts,
  resolveAccountForSession: () => "personal",
}));
vi.mock("../claudeUsage/limits", () => ({
  getAccountLimits: (id: string) =>
    h.limits.has(id)
      ? Promise.resolve(h.limits.get(id))
      : Promise.reject(new Error("no probe")),
}));
vi.mock("../telemetry/telemetry", () => ({ capture: h.capture }));
vi.mock("./limitResume", () => ({
  isLimitStalled: () => h.stalled,
  endLimitStall: h.endStall,
}));

const { appState } = await import("../../state");
const { handoffCandidates, limitHandoffAccounts, noteLimitStallStarted } =
  await import("./limitHandoff");

function account(id: string, over: Partial<ClaudeAccount> = {}): ClaudeAccount {
  return {
    id,
    email: `${id}@example.com`,
    account_type: "claudeai",
    created_at: 0,
    ...over,
  };
}

function limits(id: string, usedPercent: number[]): ClaudeAccountLimits {
  return {
    account_id: id,
    label: id,
    status: "ok",
    subscription_type: "max",
    checked_at: 0,
    windows: usedPercent.map((used, i) => ({
      id: `w${i}`,
      kind: i === 0 ? "session" : "weekly",
      label: i === 0 ? "Session" : "Weekly",
      used_percent: used,
      resets_at: Date.now() + 60_000,
      window_minutes: 300,
      pace: null,
    })),
  };
}

describe("limit handoff", () => {
  beforeEach(() => {
    appState.agents.clear();
    appState.sessions.clear();
    appState.agents.set("a1", {
      agentId: "a1",
      sessionId: "s1",
      status: "idle",
      accountId: "personal",
    } as unknown as AgentSession);
    h.accounts = [account("personal")];
    h.limits.clear();
    h.stalled = true;
    h.capture.mockClear();
    h.endStall.mockClear();
  });

  it("offers nothing with a single account", async () => {
    expect(handoffCandidates("a1")).toEqual([]);
    await expect(limitHandoffAccounts("a1")).resolves.toEqual([]);
    noteLimitStallStarted("a1");
    expect(h.capture).not.toHaveBeenCalled();
  });

  it("leaves out the current, limited, logged-out and unfinished accounts", () => {
    h.accounts = [
      account("personal"),
      account("work"),
      account("spent", { rate_limited: true }),
      account("expired", { needs_reauth: true }),
      account("pending", { email: undefined }),
    ];
    expect(handoffCandidates("a1").map((a) => a.id)).toEqual(["work"]);
  });

  it("shows the tightest window, or none when the probe fails", async () => {
    h.accounts = [
      account("personal"),
      account("work", { label: "Work" }),
      account("side"),
    ];
    h.limits.set("work", limits("work", [20, 65]));

    const rows = await limitHandoffAccounts("a1");

    expect(rows).toEqual([
      expect.objectContaining({
        account_id: "work",
        label: "Work",
        detail: "work@example.com",
        usage: expect.objectContaining({ label: "Weekly", used_percent: 65 }),
      }),
      expect.objectContaining({ account_id: "side", usage: null }),
    ]);
  });

  it("drops an account whose plan is already spent", async () => {
    h.accounts = [account("personal"), account("work")];
    h.limits.set("work", limits("work", [100]));
    await expect(limitHandoffAccounts("a1")).resolves.toEqual([]);
  });

  it("offers nothing once the stall is over", async () => {
    h.accounts = [account("personal"), account("work")];
    h.stalled = false;
    await expect(limitHandoffAccounts("a1")).resolves.toEqual([]);
  });

  it("ends a stale stall when the chat's own plan has room again", async () => {
    h.accounts = [account("personal"), account("work")];
    h.limits.set("personal", limits("personal", [40]));
    h.limits.set("work", limits("work", [10]));
    await expect(limitHandoffAccounts("a1")).resolves.toEqual([]);
    expect(h.endStall).toHaveBeenCalledWith("a1");
  });

  it("keeps offering while the chat's own plan is spent", async () => {
    h.accounts = [account("personal"), account("work")];
    h.limits.set("personal", limits("personal", [100]));
    h.limits.set("work", limits("work", [10]));
    await expect(limitHandoffAccounts("a1")).resolves.toHaveLength(1);
    expect(h.endStall).not.toHaveBeenCalled();
  });

  it("counts an offer only when there is somewhere to go", () => {
    h.accounts = [account("personal"), account("work"), account("side")];
    noteLimitStallStarted("a1");
    expect(h.capture).toHaveBeenCalledWith("limit_handoff_offered", {
      eligible_count_bucket: "2",
    });
  });
});
