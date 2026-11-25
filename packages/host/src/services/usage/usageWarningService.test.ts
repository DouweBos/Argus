import type { ClaudeAccountLimits } from "@argus/remote-protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  present: vi.fn(),
  capture: vi.fn(),
  percent: undefined as number | undefined,
  active: "work",
  fired: {} as Record<string, unknown>,
  limits: new Map<string, ClaudeAccountLimits>(),
}));

vi.mock("../notifications/osNotification", () => ({
  presentNotification: h.present,
}));
vi.mock("../telemetry/telemetry", () => ({ capture: h.capture }));
vi.mock("../appSettings/store", () => ({
  loadAppSettings: () => ({ usage_warning_percent: h.percent }),
}));
vi.mock(import("../claudeAuth/accounts"), async (importOriginal) => ({
  ...(await importOriginal()),
  getActiveAccountId: () => h.active,
  resolveAccountForSession: () => h.active,
  listClaudeAccounts: () =>
    [
      { id: "work", label: "Work", email: "w@example.com" },
      { id: "personal", label: "Personal", email: "p@example.com" },
    ] as never,
}));
vi.mock("../agent/limitHandoff", () => ({
  limitsWithin: (id: string) => Promise.resolve(h.limits.get(id) ?? null),
  tightestWindow: (l: ClaudeAccountLimits | null) => l?.windows[0] ?? null,
}));
vi.mock("./limits", () => ({ getAccountLimits: vi.fn() }));
vi.mock("./usageWarningLog", () => ({
  loadFiredWarnings: () => ({ ...h.fired }),
  saveFiredWarnings: (f: Record<string, unknown>) => {
    h.fired = f;
  },
}));

const { emitHostEvent } = await import("@argus/host/bus");
const { startUsageWarnings, stopUsageWarnings } =
  await import("./usageWarningService");

function reading(id: string, used: number): ClaudeAccountLimits {
  return {
    account_id: id,
    label: id,
    status: "ok",
    subscription_type: "max",
    windows: [
      {
        id: "five_hour",
        kind: "session",
        label: "Session",
        used_percent: used,
        resets_at: Date.now() + 3_600_000,
        window_minutes: 300,
        pace: null,
      },
    ],
    checked_at: Date.now(),
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

describe("usage warnings", () => {
  beforeEach(() => {
    h.present.mockClear();
    h.capture.mockClear();
    h.percent = undefined;
    h.fired = {};
    h.limits.clear();
    startUsageWarnings();
  });
  afterEach(() => stopUsageWarnings());

  it("warns once as a needs-you notification with Switch", async () => {
    h.limits.set("personal", reading("personal", 20));
    emitHostEvent("usage:limits-changed", reading("work", 92));
    await settle();
    emitHostEvent("usage:limits-changed", reading("work", 95));
    await settle();

    expect(h.present).toHaveBeenCalledTimes(1);
    const [payload] = h.present.mock.calls[0] as [Record<string, unknown>];
    expect(payload).toMatchObject({
      kind: "usage",
      account_id: "personal",
      actions: [{ id: "switch_account", title: "Switch to Personal" }],
    });
    expect(h.capture).toHaveBeenCalledWith("usage_warning_sent", {
      runner: "claude-code",
      threshold_bucket: "90",
      switch_offered: true,
    });
  });

  it("offers no switch when every other account is low too", async () => {
    h.limits.set("personal", reading("personal", 97));
    emitHostEvent("usage:limits-changed", reading("work", 92));
    await settle();

    const [payload] = h.present.mock.calls[0] as [Record<string, unknown>];
    expect(payload).toMatchObject({ account_id: null, actions: [] });
  });

  it("stays quiet when turned off or under the threshold", async () => {
    emitHostEvent("usage:limits-changed", reading("work", 80));
    h.percent = 0;
    emitHostEvent("usage:limits-changed", reading("work", 99));
    await settle();

    expect(h.present).not.toHaveBeenCalled();
  });

  it("ignores accounts nothing runs on", async () => {
    emitHostEvent("usage:limits-changed", reading("personal", 99));
    await settle();

    expect(h.present).not.toHaveBeenCalled();
  });
});
