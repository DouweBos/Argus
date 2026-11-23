/** The signal poller and the event dispatcher it feeds. */

import type { SignalEvent } from "../signals/types";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@argus/host/bus", () => ({ emitHostEvent: vi.fn() }));
vi.mock("../telemetry/telemetry", () => ({ capture: vi.fn() }));
const startAutomationRun = vi.fn();
vi.mock("./runner", () => ({ startAutomationRun }));
const collectSignalEvents = vi.fn();
vi.mock("../signals/registry", () => ({
  collectSignalEvents,
  enrichSignalEvent: (e: SignalEvent) =>
    Promise.resolve({ ...e, detail: { ...e.detail, enriched: true } }),
}));

const { createAutomation, createRun, resetAutomationCache, updateAutomation } =
  await import("./manager");
const { pollSignalTriggers, resetSignalWatch, SIGNAL_POLL_MS } =
  await import("./signalWatch");
const { drainAutomationEvents, fireAutomationFromEvent, resetEventDispatch } =
  await import("./eventDispatch");

let home: string;
let previousHome: string | undefined;
let now: number;
let running: boolean;

function ev(id: string, labels: string[] = []): SignalEvent {
  return {
    kind: "new_issue",
    key: `new_issue:${id}`,
    item: {
      source_id: "github",
      external_id: id,
      url: "",
      title: id,
      body: "",
      state: "open",
      assignee: null,
      labels,
      priority: null,
      updated_at: 0,
      kind: "issue",
      repo_root: null,
    },
    detail: {},
  };
}

function serve(events: SignalEvent[]): void {
  collectSignalEvents.mockResolvedValue({ events, failed: [] });
}

async function poll(): Promise<void> {
  now += SIGNAL_POLL_MS;
  await pollSignalTriggers(now);
}

function watcher(fire: "batch" | "each" = "each", cap = 4): string {
  return createAutomation({
    name: "Triage",
    enabled: true,
    playbook: "triage",
    trigger: {
      kind: "signal",
      on: ["new_issue"],
      labels: [],
      fire,
      max_runs_per_hour: cap,
    },
  }).id;
}

function reasons(): string[] {
  return startAutomationRun.mock.calls.map((c) => c[1] as string);
}

describe("signal watch", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-signal-"));
    process.env.ARGUS_HOME = home;
    resetAutomationCache();
    resetSignalWatch();
    resetEventDispatch();
    now = 1_000_000;
    running = false;
    startAutomationRun.mockReset();
    startAutomationRun.mockImplementation((automationId: string) =>
      createRun(automationId, running ? "running" : "succeeded", "test"),
    );
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env.ARGUS_HOME;
    } else {
      process.env.ARGUS_HOME = previousHome;
    }
    fs.rmSync(home, { force: true, recursive: true });
  });

  it("ignores the backlog, then fires with the event and its detail", async () => {
    const id = watcher();
    serve([ev("acme/app#1")]);
    await poll();
    expect(startAutomationRun).not.toHaveBeenCalled();

    serve([ev("acme/app#1"), ev("acme/app#2")]);
    await poll();
    expect(startAutomationRun).toHaveBeenCalledTimes(1);
    const [automationId, reason, { events }] = startAutomationRun.mock.calls[0];
    expect(automationId).toBe(id);
    expect(reason).toBe("new_issue acme/app#2");
    expect(events[0]).toMatchObject({
      origin: "signal",
      kind: "new_issue",
      payload: { kind: "new_issue", enriched: true },
    });
  });

  it("does not refire after a restart", async () => {
    watcher();
    serve([ev("a")]);
    await poll();
    serve([ev("a"), ev("b")]);
    await poll();
    resetSignalWatch();
    resetEventDispatch();
    await poll();
    expect(startAutomationRun).toHaveBeenCalledTimes(1);
  });

  it("rebaselines after being paused", async () => {
    const id = watcher();
    serve([]);
    await poll();
    updateAutomation(id, { enabled: false });
    await poll();
    updateAutomation(id, { enabled: true });
    serve([ev("a")]);
    await poll();
    expect(startAutomationRun).not.toHaveBeenCalled();
  });

  it("queues events while a run is going and runs them one at a time", async () => {
    watcher("each");
    serve([]);
    await poll();
    running = true;
    serve([ev("a"), ev("b")]);
    await poll();
    expect(reasons()).toEqual(["new_issue a"]);

    drainAutomationEvents(now);
    expect(reasons()).toHaveLength(1);
  });

  it("coalesces a burst into one run in batch mode", async () => {
    watcher("batch");
    serve([]);
    await poll();
    serve([ev("a"), ev("b"), ev("c")]);
    await poll();
    expect(reasons()).toEqual(["3 events"]);
  });

  it("holds at the hourly cap and releases as fires age out", async () => {
    watcher("each", 1);
    serve([]);
    await poll();
    serve([ev("a"), ev("b")]);
    await poll();
    expect(reasons()).toHaveLength(1);
    drainAutomationEvents(now + 10 * 60_000);
    expect(reasons()).toHaveLength(1);
    drainAutomationEvents(now + 61 * 60_000);
    expect(reasons()).toEqual(["new_issue a", "new_issue b"]);
  });
});

describe("fireAutomationFromEvent", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-dispatch-"));
    process.env.ARGUS_HOME = home;
    resetAutomationCache();
    resetEventDispatch();
    startAutomationRun.mockReset();
    startAutomationRun.mockImplementation((automationId: string) =>
      createRun(automationId, "succeeded", "test"),
    );
  });

  afterEach(() => {
    process.env.ARGUS_HOME = previousHome;
    fs.rmSync(home, { force: true, recursive: true });
  });

  const event = {
    origin: "test",
    kind: "webhook",
    summary: "webhook",
    items: [],
    payload: { ok: true },
    received_at: 0,
  };

  it("refuses automations whose trigger doesn't take events", () => {
    const { id } = createAutomation({
      name: "Clock",
      enabled: true,
      playbook: "x",
      trigger: { kind: "manual" },
    });
    expect(fireAutomationFromEvent(id, event)).toMatchObject({
      accepted: false,
    });
  });

  it("refuses paused automations and starts a run for live ones", () => {
    const { id } = createAutomation({
      name: "Hook",
      enabled: false,
      playbook: "x",
      trigger: { kind: "webhook", fire: "each", max_runs_per_hour: 4 },
    });
    expect(fireAutomationFromEvent(id, event).accepted).toBe(false);
    updateAutomation(id, { enabled: true });
    expect(fireAutomationFromEvent(id, event)).toEqual({
      accepted: true,
      queued: 0,
    });
    expect(startAutomationRun).toHaveBeenCalledWith(id, "webhook", {
      events: [event],
    });
  });
});
