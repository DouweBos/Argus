import type { ActivityAgent } from "./state";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const agents: ActivityAgent[] = [];
const captured: { name: string; props: unknown }[] = [];

vi.mock("./collect", () => ({
  collectAgents: () => agents,
  recordStatus: () => undefined,
  resetCollected: () => undefined,
}));
vi.mock("../../deviceStore", () => ({
  getPushConfig: async () => ({ enabled: true, relay_url: "" }),
}));
vi.mock("../../../telemetry/telemetry", () => ({
  capture: (name: string, props: unknown) => captured.push({ name, props }),
}));

const { registerLiveActivity, stopLiveActivities, unregisterLiveActivity } =
  await import("./dispatch");

const PUSH_KEY = randomBytes(32).toString("base64");
const AUTH_KEY = randomBytes(32).toString("base64");
const TOKEN = "ab".repeat(32);

interface Sent {
  url: string;
  signature: string;
  body: {
    token: string;
    service: string;
    payload: string;
    ts: number;
  };
  payload: {
    event: string;
    state: { p: string; e: string; t: number };
    priority: number;
    dismiss_at?: number;
  };
}

let sent: Sent[];
let reply: () => Response;

function working(id: string): ActivityAgent {
  return {
    id,
    sessionId: "s1",
    title: "Fix the login form",
    project: "argus",
    state: "working",
    startedAt: Date.now(),
    endedAt: null,
    step: "Edit Login.swift",
    prompt: null,
  };
}

function register(): void {
  registerLiveActivity("phone", {
    token: TOKEN,
    environment: "sandbox",
    pushKey: PUSH_KEY,
    authKey: AUTH_KEY,
  });
}

describe("live activity dispatch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    captured.length = 0;
    agents.length = 0;
    reply = () =>
      new Response(JSON.stringify({ delivered: true, environment: "sandbox" }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as Sent["body"];
        sent.push({
          url,
          signature: (init.headers as Record<string, string>)["x-argus-auth"]!,
          body,
          payload: JSON.parse(body.payload) as Sent["payload"],
        });

        return reply();
      }),
    );
  });

  afterEach(() => {
    stopLiveActivities();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("posts a signed, sealed update to the relay's activity route", async () => {
    agents.push(working("a"));
    register();
    await vi.advanceTimersByTimeAsync(400);

    expect(sent).toHaveLength(1);
    const [first] = sent;
    expect(first!.url).toBe("https://houwert.dev/argus/push/activity");
    expect(first!.payload.event).toBe("update");
    expect(first!.payload.state.p).toBe("working");
    expect(first!.payload.priority).toBe(10);
    // Nothing readable leaves the machine but the phase.
    expect(first!.body.payload).not.toContain("Login");

    const digest = createHash("sha256")
      .update(first!.body.payload)
      .digest("hex");
    const expected = createHmac("sha256", Buffer.from(AUTH_KEY, "base64"))
      .update(
        ["activity", "apns", TOKEN, String(first!.body.ts), digest].join("\n"),
      )
      .digest("base64");
    expect(first!.signature).toBe(expected);
  });

  it("skips unchanged snapshots", async () => {
    agents.push(working("a"));
    register();
    await vi.advanceTimersByTimeAsync(400);
    register();
    await vi.advanceTimersByTimeAsync(400);

    expect(sent).toHaveLength(1);
  });

  it("ends the activity a grace period after everything settled", async () => {
    agents.push({ ...working("a"), state: "done", endedAt: Date.now() });
    register();
    await vi.advanceTimersByTimeAsync(400);
    expect(sent.map((s) => s.payload.event)).toEqual(["update"]);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent.map((s) => s.payload.event)).toEqual(["update", "end"]);
    expect(sent[1]!.payload.dismiss_at).toBeGreaterThan(Date.now() / 1000);
    expect(captured).toEqual([
      {
        name: "live_activity_ended",
        props: { reason: "settled", updates: 2, failed_sends: 0 },
      },
    ]);
  });

  it("forgets a token the user dismissed", async () => {
    agents.push(working("a"));
    reply = () =>
      new Response(
        JSON.stringify({ delivered: false, reason: "BadDeviceToken" }),
        { status: 400 },
      );
    register();
    await vi.advanceTimersByTimeAsync(400);
    expect(captured[0]).toMatchObject({ props: { reason: "token_dead" } });

    agents.push(working("b"));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sent).toHaveLength(1);
  });

  it("stops on unregister", async () => {
    agents.push(working("a"));
    register();
    unregisterLiveActivity("phone");
    await vi.advanceTimersByTimeAsync(400);

    expect(sent).toHaveLength(0);
    expect(captured[0]).toMatchObject({ props: { reason: "unregistered" } });
  });
});
