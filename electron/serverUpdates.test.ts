/**
 * The tray is the packaged server's only way to take an update, and installing
 * one restarts the machine's whole agent fleet — so the phase mapping and,
 * above all, the refuse-while-agents-are-running guard are pinned down here.
 */

import type { UpdaterState } from "./services/updater";
import type { AgentSession } from "@argus/host/services/agent/models";
import { beforeEach, describe, expect, it, vi } from "vitest";

const agents = new Map<string, AgentSession>();
vi.mock("@argus/host/state", () => ({ appState: { agents } }));

vi.mock("@argus/host/serverMode", () => ({ isServerMode: () => true }));

const store: { settings: Record<string, unknown> } = { settings: {} };
vi.mock("@argus/host/services/appSettings/store", () => ({
  loadAppSettings: () => store.settings,
  saveAppSettings: (next: Record<string, unknown>) => {
    store.settings = { ...store.settings, ...next };

    return store.settings;
  },
}));

const updater = {
  state: {
    currentVersion: "1.0.0",
    error: null,
    phase: "idle",
    progressPercent: 0,
    releaseNotes: null,
    releaseDate: null,
    updateVersion: null,
    lastCheckedAt: null,
  } as UpdaterState,
  check: vi.fn(async (_o?: { silent?: boolean }) => undefined),
  download: vi.fn(async () => undefined),
  install: vi.fn(),
};
vi.mock("./services/updater", () => ({
  checkForUpdates: (o?: { silent?: boolean }) => updater.check(o),
  downloadUpdate: () => updater.download(),
  getUpdaterState: () => updater.state,
  quitAndInstallUpdate: () => updater.install(),
}));

const {
  canInstallServerUpdate,
  checkServerUpdates,
  describeServerUpdate,
  downloadServerUpdate,
  getServerUpdateState,
  initServerUpdates,
  installServerUpdate,
  isServerAutoInstallEnabled,
  setServerAutoInstallEnabled,
  setServerUpdateListener,
  stopServerUpdates,
} = await import("./serverUpdates");

function setPhase(patch: Partial<UpdaterState>): void {
  updater.state = { ...updater.state, ...patch };
}

/** A minimally-shaped agent — only the fields activity depends on. */
function addAgent(id: string, patch: Partial<AgentSession> = {}): void {
  agents.set(id, {
    agentId: id,
    sessionId: "s1",
    createdAt: 1,
    status: "running",
    inflightPrompts: 0,
    prewarmed: false,
    ...patch,
  } as AgentSession);
}

describe("server tray updates", () => {
  beforeEach(() => {
    agents.clear();
    store.settings = {};
    vi.clearAllMocks();
    stopServerUpdates();
    setPhase({
      phase: "idle",
      updateVersion: null,
      progressPercent: 0,
      error: null,
    });
  });

  it("maps every updater phase onto a menu state", () => {
    const base = updater.state;
    expect(describeServerUpdate({ ...base, phase: "idle" })).toEqual({
      kind: "idle",
    });
    expect(describeServerUpdate({ ...base, phase: "checking" })).toEqual({
      kind: "checking",
    });
    expect(describeServerUpdate({ ...base, phase: "not-available" })).toEqual({
      kind: "up_to_date",
    });
    expect(
      describeServerUpdate({
        ...base,
        phase: "available",
        updateVersion: "1.2.3",
      }),
    ).toEqual({ kind: "available", version: "1.2.3" });
    expect(
      describeServerUpdate({
        ...base,
        phase: "downloading",
        progressPercent: 42,
      }),
    ).toEqual({ kind: "downloading", percent: 42 });
    expect(
      describeServerUpdate({
        ...base,
        phase: "downloaded",
        updateVersion: "1.2.3",
      }),
    ).toEqual({ kind: "ready", version: "1.2.3" });
    expect(
      describeServerUpdate({ ...base, phase: "error", error: "no feed" }),
    ).toEqual({ kind: "error", message: "no feed" });
  });

  it("reads the live updater state", () => {
    setPhase({ phase: "available", updateVersion: "9.9.9" });

    expect(getServerUpdateState()).toEqual({
      kind: "available",
      version: "9.9.9",
    });
  });

  it("checks loudly so the menu can show 'checking'", async () => {
    await checkServerUpdates();

    expect(updater.check).toHaveBeenCalledWith({ silent: false });
  });

  it("downloads on demand without flipping autoDownload", async () => {
    await downloadServerUpdate();

    expect(updater.download).toHaveBeenCalled();
  });

  it("refuses to install when nothing is downloaded", () => {
    setPhase({ phase: "available", updateVersion: "1.2.3" });

    expect(installServerUpdate()).toEqual({ ok: false, reason: "not_ready" });
    expect(updater.install).not.toHaveBeenCalled();
  });

  it("refuses to restart while agents are running, and counts them", () => {
    setPhase({ phase: "downloaded", updateVersion: "1.2.3" });
    addAgent("a");
    addAgent("b", { status: "requires_action" });
    addAgent("c", { status: "idle", inflightPrompts: 1 });

    expect(installServerUpdate()).toEqual({
      ok: false,
      reason: "agents_running",
      activeAgents: 3,
    });
    expect(updater.install).not.toHaveBeenCalled();
  });

  it("ignores stopped, errored and prewarmed agents", () => {
    setPhase({ phase: "downloaded", updateVersion: "1.2.3" });
    addAgent("a", { status: "stopped" });
    addAgent("b", { status: "error" });
    addAgent("c", { prewarmed: true });
    addAgent("d", { status: "idle" });

    expect(canInstallServerUpdate()).toEqual({ ok: true });
  });

  it("installs when the machine is idle and an update is ready", () => {
    setPhase({ phase: "downloaded", updateVersion: "1.2.3" });

    expect(installServerUpdate()).toEqual({ ok: true });
    expect(updater.install).toHaveBeenCalled();
  });

  it("keeps auto-install off by default", () => {
    expect(isServerAutoInstallEnabled()).toBe(false);
  });

  it("persists the auto-install toggle", () => {
    setServerAutoInstallEnabled(true);

    expect(store.settings.server_auto_install_updates).toBe(true);
    expect(isServerAutoInstallEnabled()).toBe(true);
  });

  it("auto-installs the moment it is enabled if already idle and ready", () => {
    setPhase({ phase: "downloaded", updateVersion: "1.2.3" });

    setServerAutoInstallEnabled(true);

    expect(updater.install).toHaveBeenCalled();
  });

  it("auto-install still respects the running-agents guard", () => {
    setPhase({ phase: "downloaded", updateVersion: "1.2.3" });
    addAgent("a");

    setServerAutoInstallEnabled(true);

    expect(updater.install).not.toHaveBeenCalled();
  });

  it("notifies the tray when the updater state changes", async () => {
    const { emitHostEvent } = await import("@argus/host/bus");
    const seen: string[] = [];
    initServerUpdates();
    setServerUpdateListener(() => seen.push(getServerUpdateState().kind));

    setPhase({ phase: "checking" });
    emitHostEvent("updater:state", updater.state);
    setPhase({ phase: "downloading", progressPercent: 10 });
    emitHostEvent("updater:state", updater.state);
    emitHostEvent("session:updated", {});

    expect(seen).toEqual(["checking", "downloading"]);
  });

  it("auto-installs once the last agent finishes", async () => {
    const { emitHostEvent } = await import("@argus/host/bus");
    store.settings = { server_auto_install_updates: true };
    setPhase({ phase: "downloaded", updateVersion: "1.2.3" });
    addAgent("a");
    initServerUpdates();

    emitHostEvent("updater:state", updater.state);
    expect(updater.install).not.toHaveBeenCalled();

    agents.clear();
    emitHostEvent("updater:state", updater.state);
    expect(updater.install).toHaveBeenCalled();
  });

  it("sweeps for idleness on a timer, not just on updater events", () => {
    vi.useFakeTimers();
    store.settings = { server_auto_install_updates: true };
    setPhase({ phase: "downloaded", updateVersion: "1.2.3" });
    addAgent("a");
    initServerUpdates();

    vi.advanceTimersByTime(60_000);
    expect(updater.install).not.toHaveBeenCalled();

    agents.clear();
    vi.advanceTimersByTime(60_000);
    expect(updater.install).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("stops listening after teardown", async () => {
    const { emitHostEvent } = await import("@argus/host/bus");
    initServerUpdates();
    const seen: string[] = [];
    setServerUpdateListener(() => seen.push("x"));
    stopServerUpdates();

    emitHostEvent("updater:state", updater.state);

    expect(seen).toEqual([]);
  });
});
