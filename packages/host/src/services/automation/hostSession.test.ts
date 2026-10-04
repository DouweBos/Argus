/**
 * The run's own session is built by hand rather than through `createSession`,
 * so the runner cascade has to be wired here explicitly — a missed stamp sends
 * every automation to Claude Code whatever the settings say.
 */

import type { LlmRunner } from "../llm/runners/types";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appState } from "../../state";
import { saveAppSettings } from "../appSettings/store";
import { registerRunner } from "../llm/registry";
import { hydrateHostState } from "../session/hostState";
import {
  createAutomationHostSession,
  restoreAutomationHostSession,
} from "./hostSession";

let home: string;
let previousHome: string | undefined;

function fakeRunner(id: string): LlmRunner {
  return {
    id,
    displayName: id,
    isCustom: true,
    capabilities: () => ({
      supportsMcp: true,
      supportsTranscriptFork: true,
      supportsSetModel: true,
      supportsSetPermissionMode: true,
      supportsSetEffort: true,
      supportsInterrupt: true,
    }),
    preflight: async () => ({ ok: true, binPath: "/usr/bin/fake" }),
    spawn: async () => ({}) as never,
    oneShot: async () => null,
  };
}

describe("createAutomationHostSession", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-host-session-"));
    process.env.ARGUS_HOME = home;
    registerRunner(fakeRunner("custom:apex"));
    registerRunner(fakeRunner("custom:other"));
  });

  afterEach(() => {
    appState.sessions.clear();
    if (previousHome === undefined) {
      delete process.env.ARGUS_HOME;
    } else {
      process.env.ARGUS_HOME = previousHome;
    }
    fs.rmSync(home, { force: true, recursive: true });
  });

  it("stamps the runner the automation pinned", () => {
    saveAppSettings({ default_llm: { runner: "custom:other", model: null } });

    const session = createAutomationHostSession({
      automationId: "a1",
      runId: "r1",
      displayName: "Standup digest",
      runner: "custom:apex",
      model: "callstack/Apex",
    });

    expect(session.runner_id).toBe("custom:apex");
    expect(session.model).toBe("callstack/Apex");
  });

  it("falls back to the app default when the automation pinned none", () => {
    saveAppSettings({ default_llm: { runner: "custom:other", model: "m1" } });

    const session = createAutomationHostSession({
      automationId: "a1",
      runId: "r2",
      displayName: "Standup digest",
      runner: null,
      model: null,
    });

    expect(session.runner_id).toBe("custom:other");
    expect(session.model).toBe("m1");
  });
});

describe("a run's session after a restart", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-host-session-"));
    process.env.ARGUS_HOME = home;
  });

  afterEach(() => {
    appState.sessions.clear();
    if (previousHome === undefined) {
      delete process.env.ARGUS_HOME;
    } else {
      process.env.ARGUS_HOME = previousHome;
    }
    fs.rmSync(home, { force: true, recursive: true });
  });

  const options = {
    automationId: "a1",
    runId: "r1",
    displayName: "Standup digest",
  };

  it("comes back under the id the run recorded, and is in the host snapshot", async () => {
    const created = createAutomationHostSession(options);
    appState.sessions.clear();

    restoreAutomationHostSession(created.id, options);

    expect(appState.sessions.get(created.id)).toMatchObject({
      kind: "automation_host",
      path: created.path,
      display_name: "Standup digest",
    });
    const snapshot = await hydrateHostState();
    expect(snapshot.sessions.map((s) => s.id)).toContain(created.id);
  });

  it("stays gone once the run's directory is", () => {
    const created = createAutomationHostSession(options);
    appState.sessions.clear();
    fs.rmSync(created.path, { recursive: true });

    restoreAutomationHostSession(created.id, options);

    expect(appState.sessions.has(created.id)).toBe(false);
  });
});
