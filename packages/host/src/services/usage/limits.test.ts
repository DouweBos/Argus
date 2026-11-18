import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const events = vi.hoisted(() => [] as [string, unknown][]);
const usage = vi.hoisted(() => ({
  response: {
    rate_limits_available: true,
    rate_limits: { five_hour: { utilization: 10, resets_at: null } },
  } as unknown,
}));
vi.mock("@argus/host/bus", () => ({
  emitHostEvent: (channel: string, payload: unknown) =>
    events.push([channel, payload]),
}));
vi.mock("../telemetry/telemetry", () => ({ capture: () => {} }));
vi.mock("../claudeAuth/accounts", () => ({
  DEFAULT_ACCOUNT_ID: "default",
  envForAccount: () => ({}),
  listClaudeAccounts: () => [],
}));

/** A `claude` that answers `get_usage` with 10% of the session window used. */
vi.mock("node:child_process", () => ({
  spawn: () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stdin: {
        on: () => {},
        write: (line: string) => {
          if (!line.includes("get_usage")) {
            return;
          }
          const response = usage.response;
          setImmediate(() =>
            child.stdout.emit(
              "data",
              Buffer.from(
                `${JSON.stringify({
                  type: "control_response",
                  response: {
                    request_id: "usage",
                    subtype: "success",
                    response,
                  },
                })}\n`,
              ),
            ),
          );
        },
      },
      kill: () => {},
    });

    return child;
  },
}));

const { getClaudeUsageLimits, noteUsageRateLimitLine } =
  await import("./limits");

const sessionUsed = (payload: unknown) =>
  (payload as { windows: { id: string; used_percent: number }[] }).windows.find(
    (w) => w.id === "five_hour",
  )?.used_percent;

describe("usage limit change events", () => {
  it("announces a probe and a running agent's rate-limit report", async () => {
    await getClaudeUsageLimits(true);
    expect(events.at(-1)?.[0]).toBe("usage:limits-changed");
    expect(sessionUsed(events.at(-1)?.[1])).toBe(10);

    noteUsageRateLimitLine(
      "default",
      JSON.stringify({
        type: "rate_limit_event",
        rate_limit_info: { rateLimitType: "five_hour", utilization: 0.43 },
      }),
    );
    expect(events.at(-1)?.[0]).toBe("usage:limits-changed");
    expect(sessionUsed(events.at(-1)?.[1])).toBeCloseTo(43);
  });
});

describe("a signed-out account", () => {
  it("says so instead of reporting no plan limits", async () => {
    usage.response = {
      subscription_type: null,
      rate_limits_available: false,
      rate_limits: null,
    };
    const [account] = (await getClaudeUsageLimits(true)).accounts;
    expect(account?.status).toBe("unsupported");
    expect(account?.message).toMatch(/Signed out/);
  });
});
