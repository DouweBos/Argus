// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { durationBucket } from "./events";

type Sent = { event: string; distinct_id: string; properties: Record<string, unknown> };

const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
  sent.push(JSON.parse(String(init.body)) as Sent);

  return new Response("{}");
});
let sent: Sent[] = [];

/** A fresh module, so its key and mode are read again. */
async function load(key: string) {
  vi.resetModules();
  vi.stubEnv("VITE_POSTHOG_KEY", key);

  return import("./telemetry");
}

describe("web telemetry", () => {
  beforeEach(() => {
    sent = [];
    localStorage.clear();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends nothing at all without a key", async () => {
    const t = await load("");
    t.startTelemetry("network", true);
    t.setTelemetryMode("full");
    t.capture("web_paired", { has_control: true });

    expect(sent).toEqual([]);
    expect(t.telemetryConfigured()).toBe(false);
  });

  it("sends only the heartbeat in presence mode", async () => {
    const t = await load("phc_test");
    t.startTelemetry("network", false);
    t.capture("web_paired", { has_control: true });
    t.captureScreen("/settings");

    expect(sent.map((e) => e.event)).toEqual(["$pageview"]);
    expect(sent[0].properties).toMatchObject({
      $pathname: "/",
      source: "heartbeat",
      $process_person_profile: false,
    });
    expect(sent[0].properties).not.toHaveProperty("client");
  });

  it("sends the catalog and screen patterns once opted in", async () => {
    const t = await load("phc_test");
    t.startTelemetry("hosted", false);
    t.setTelemetryMode("full");
    t.captureScreen("/sessions/:sessionId/agents");

    expect(sent.map((e) => e.event)).toEqual([
      "$pageview",
      "telemetry_enabled",
      "web_launched",
      "$screen",
    ]);
    expect(sent[3].properties).toMatchObject({
      $screen_name: "/sessions/:sessionId/agents",
      client: "web",
      build: "hosted",
      $geoip_disable: true,
    });
    expect(t.hasAnsweredConsent()).toBe(true);
  });

  it("keeps one install id across visits", async () => {
    let t = await load("phc_test");
    t.startTelemetry("network", false);
    t = await load("phc_test");
    t.startTelemetry("network", false);

    expect(sent).toHaveLength(2);
    expect(sent[0].distinct_id).toBe(sent[1].distinct_id);
  });

  it("records the downgrade before going quiet", async () => {
    localStorage.setItem("argus.telemetry.mode", "full");
    const t = await load("phc_test");
    t.startTelemetry("network", true);
    sent = [];
    t.setTelemetryMode("presence");
    t.capture("web_paired", { has_control: false });

    expect(sent.map((e) => e.event)).toEqual(["telemetry_disabled"]);
  });
});

describe("duration buckets", () => {
  it("never carries the exact duration", () => {
    expect(durationBucket(5_000)).toBe("<10s");
    expect(durationBucket(30_000)).toBe("10s-1m");
    expect(durationBucket(5 * 60_000)).toBe("1m-10m");
    expect(durationBucket(30 * 60_000)).toBe("10m-1h");
    expect(durationBucket(5 * 3_600_000)).toBe("1h+");
  });
});
