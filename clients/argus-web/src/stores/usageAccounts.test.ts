// @vitest-environment jsdom
import type { Transport } from "@argus/remote-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useClaudeAccountsStore } from "./claudeAccounts";
import { useConnectionStore } from "./connection";
import { resetHostStores, routeEvent } from "./hostSync";
import {
  installNotifications,
  reportError,
  resetNotificationsForTest,
  useNotificationsStore,
} from "./notifications";
import { useProjectsStore } from "./projects";
import { USAGE_LIMITS_TIMEOUT_MS, useUsageStore } from "./usage";

type Handler = (params: Record<string, unknown>) => unknown;

function fakeTransport(handlers: Record<string, Handler>) {
  const request = vi.fn(
    async (method: string, params: Record<string, unknown>) => {
      const handler = handlers[method];
      if (!handler) {
        throw Object.assign(new Error(`no ${method}`), { code: "not_found" });
      }

      return handler(params);
    },
  );
  useConnectionStore.setState({
    transport: { request } as unknown as Transport,
    connection: "ready",
  });

  return request;
}

const account = (id: string, label: string) => ({
  id,
  label,
  email: `${id}@x.dev`,
  org_name: null,
  subscription_type: "max",
  needs_reauth: false,
  rate_limited: false,
  account_type: "claudeai" as const,
});

beforeEach(() => {
  installNotifications();
  resetNotificationsForTest();
  resetHostStores();
});

afterEach(() => {
  useConnectionStore.setState({ transport: null, connection: "offline" });
});

describe("notifications log", () => {
  it("logs a failed request once, folding repeats", async () => {
    fakeTransport({});
    await useUsageStore.getState().loadSummary("7d");
    await useUsageStore.getState().loadSummary("7d");
    const { entries } = useNotificationsStore.getState();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: "error",
      source: "usage",
      count: 2,
    });
  });

  it("keeps a dropped connection on a background refresh out", () => {
    fakeTransport({});
    reportError(Object.assign(new Error("x"), { code: "offline" }), "agents", {
      background: true,
    });
    expect(useNotificationsStore.getState().entries).toHaveLength(0);
  });

  it("calls a method an older computer lacks a warning", () => {
    fakeTransport({});
    reportError(new Error("unknown method usage.summary"), "usage");
    expect(useNotificationsStore.getState().entries[0]?.level).toBe("warning");
  });
});

describe("usage", () => {
  it("asks for limits with the long timeout and forces a refresh", async () => {
    const request = fakeTransport({
      "usage.limits": () => ({ accounts: [] }),
    });
    await useUsageStore.getState().loadLimits({ force: true });
    expect(request).toHaveBeenCalledWith(
      "usage.limits",
      { refresh: true },
      { timeoutMs: USAGE_LIMITS_TIMEOUT_MS },
    );
    expect(useUsageStore.getState().limitsLoad).toEqual({
      loaded: true,
      error: null,
    });
  });

  it("keeps a summary per range", async () => {
    fakeTransport({
      "usage.summary": (p) => ({ range: p.range, sessions: 1 }),
    });
    await useUsageStore.getState().loadSummary("7d");
    await useUsageStore.getState().loadSummary("90d");
    expect(Object.keys(useUsageStore.getState().summaries).sort()).toEqual([
      "7d",
      "90d",
    ]);
  });
});

describe("claude accounts", () => {
  it("follows the computer's pushes", () => {
    routeEvent({
      type: "evt",
      seq: 1,
      event: "claude_accounts.changed",
      payload: { accounts: [account("a", "Work")], active_id: "a" },
    });
    expect(useClaudeAccountsStore.getState().activeId).toBe("a");

    routeEvent({
      type: "evt",
      seq: 2,
      event: "claude_accounts.login",
      payload: { pending: true, needs_code: true },
    });
    expect(useClaudeAccountsStore.getState().login?.needs_code).toBe(true);
  });

  it("ends the attempt on a wrong code", async () => {
    fakeTransport({
      "claude_accounts.login_submit_code": () => ({
        ok: false,
        error: "Bad code",
      }),
      "claude_accounts.list": () => ({ accounts: [], active_id: "" }),
    });
    useClaudeAccountsStore.setState({
      login: { pending: true, needs_code: true },
    });
    await useClaudeAccountsStore.getState().submitCode(" 123 ");
    expect(useClaudeAccountsStore.getState().login).toEqual({
      pending: false,
      needs_code: false,
      ok: false,
      error: "Bad code",
    });
  });

  it("pins a session to an account without waiting for a broadcast", async () => {
    const request = fakeTransport({
      "agents.set_claude_account": () => ({ accepted: true }),
    });
    useProjectsStore.setState({
      sessionsByRepo: {
        "/r": [{ id: "s1" } as never, { id: "s2" } as never],
      },
    });
    await useClaudeAccountsStore.getState().setAgentAccount("ag", "s1", "b");
    expect(request).toHaveBeenCalledWith("agents.set_claude_account", {
      agent_id: "ag",
      account_id: "b",
    });
    const [s1, s2] = useProjectsStore.getState().sessionsByRepo["/r"];
    expect(s1.claude_account_id).toBe("b");
    expect(s2.claude_account_id).toBeUndefined();
  });
});
