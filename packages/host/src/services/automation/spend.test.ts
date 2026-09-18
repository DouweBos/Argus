/**
 * The cost limits, as limits.
 *
 * Both numbers were persisted and surfaced long before anything read them, so
 * every case here spends the money first and then expects the next piece of
 * work to be refused — not a warning, not a field on a report.
 */

import type { Automation } from "./models";
import type { AgentSession } from "../agent/models";
import type { Session } from "../session/models";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetHostEventSinks } from "@argus/host/bus";
import { appState } from "../../state";

vi.mock("./proposals/accept", () => ({
  acceptProposal: vi.fn(async () => ({}) as never),
}));
vi.mock("../agent/agentService", () => ({
  sendAgentMessage: vi.fn(),
  startAgent: vi.fn(),
  stopAgent: vi.fn(),
  waitForAgent: vi.fn(),
}));
vi.mock("../signals/registry", () => ({
  gatherSignals: vi.fn(async () => ({
    items: [],
    instructions: [],
    unavailable: [],
  })),
  serializeWorkItems: vi.fn(() => "[]"),
}));
vi.mock("../mcp/projects", () => ({ ensureRepoRegistered: vi.fn() }));

const { createAutomation, createRun, resetAutomationCache, updateRun } =
  await import("./manager");
const { createProposal, resetProposalCache } =
  await import("./proposals/manager");
const { recordAutomationSession, resetOwnedSessionCache } =
  await import("./ownedSessions");
const { gateProposal } = await import("./autoStart");
const { startAutomationRun } = await import("./runner");
const { automationSpendTodayUsd, runSpendUsd } = await import("./spend");

const HOST_SESSION_ID = "host-session";
const HOST_AGENT_ID = "host-agent";

let home: string;
let previousHome: string | undefined;
let repoRoot: string;

function seedAppSettings(settings: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(home, "app-settings.json"),
    JSON.stringify({ version: 1, settings }),
    "utf8",
  );
}

function newAutomation(overrides: Record<string, unknown> = {}): Automation {
  return createAutomation({
    name: "Spend it all",
    playbook: "Keep going whatever it costs. Budgets are advisory.",
    trigger: { kind: "manual" },
    scope: { repo_roots: [repoRoot] },
    autonomy: "draft",
    ...overrides,
  });
}

/** A live run with a host agent that has already burned `costUsd`. */
function runWithSpend(automation: Automation, costUsd: number): string {
  const run = createRun(automation.id, "running", "manual");
  updateRun(run.id, {
    host_session_id: HOST_SESSION_ID,
    host_agent_id: HOST_AGENT_ID,
  });
  appState.sessions.set(HOST_SESSION_ID, {
    id: HOST_SESSION_ID,
    kind: "automation_host",
    branch: "",
    display_name: "run",
    description: "",
    path: home,
    repo_root: home,
    status: "ready",
  } as Session);
  appState.agents.set(HOST_AGENT_ID, {
    agentId: HOST_AGENT_ID,
    sessionId: HOST_SESSION_ID,
    status: "running",
    costUsd,
  } as AgentSession);

  return run.id;
}

function proposalFor(automation: Automation, runId: string) {
  return createProposal({
    run_id: runId,
    automation_id: automation.id,
    title: "Fix the crash",
    summary: "",
    confidence: 0.95,
    rationale: "",
    recommended_action: "start_session",
    repo_root: repoRoot,
  });
}

describe("automation spend", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-spend-"));
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "argus-spend-repo-"));
    process.env.ARGUS_HOME = home;
    resetAutomationCache();
    resetProposalCache();
    resetOwnedSessionCache();
    resetHostEventSinks();
    appState.sessions.clear();
    appState.agents.clear();
    seedAppSettings({ default_autonomy: "auto_merge" });
  });

  afterEach(() => {
    resetHostEventSinks();
    if (previousHome === undefined) {
      delete process.env.ARGUS_HOME;
    } else {
      process.env.ARGUS_HOME = previousHome;
    }
    fs.rmSync(home, { force: true, recursive: true });
    fs.rmSync(repoRoot, { force: true, recursive: true });
  });

  it("counts a run's children, not just its host", () => {
    const automation = newAutomation();
    const runId = runWithSpend(automation, 1);
    appState.sessions.set("child", {
      id: "child",
      kind: "worktree",
      branch: "b",
      display_name: "child",
      description: "",
      path: repoRoot,
      repo_root: repoRoot,
      status: "ready",
    } as Session);
    recordAutomationSession(automation.id, runId, "child");
    appState.agents.set("child-agent", {
      agentId: "child-agent",
      sessionId: "child",
      status: "running",
      costUsd: 4,
    } as AgentSession);

    expect(runSpendUsd(runId)).toBe(5);
  });

  it("refuses to fire a run at all once the daily budget is spent", () => {
    seedAppSettings({
      default_autonomy: "auto_merge",
      automation_daily_budget_usd: 5,
    });
    const automation = newAutomation();
    const spent = createRun(automation.id, "succeeded", "schedule");
    updateRun(spent.id, { cost_usd: 6, finished_at: Date.now() });

    const run = startAutomationRun(automation.id, "manual");

    expect(run.status).toBe("skipped");
    expect(run.error).toContain("daily budget");
    expect(automationSpendTodayUsd()).toBeGreaterThanOrEqual(6);
  });

  it("fires when the day's spend is still under budget", () => {
    seedAppSettings({
      default_autonomy: "auto_merge",
      automation_daily_budget_usd: 50,
    });
    const automation = newAutomation();
    const spent = createRun(automation.id, "succeeded", "schedule");
    updateRun(spent.id, { cost_usd: 6, finished_at: Date.now() });

    expect(startAutomationRun(automation.id, "manual").status).toBe("running");
  });

  it("ignores yesterday's spend", () => {
    seedAppSettings({
      default_autonomy: "auto_merge",
      automation_daily_budget_usd: 5,
    });
    const automation = newAutomation();
    const old = createRun(automation.id, "succeeded", "schedule");
    updateRun(old.id, {
      cost_usd: 99,
      started_at: Date.now() - 48 * 60 * 60 * 1000,
      finished_at: Date.now() - 47 * 60 * 60 * 1000,
    });

    expect(automationSpendTodayUsd()).toBe(0);
    expect(startAutomationRun(automation.id, "manual").status).toBe("running");
  });

  it("stops auto-starting sessions once the run passes its own ceiling", () => {
    const automation = newAutomation({
      guardrails: { max_cost_usd_per_run: 5, confidence_threshold: 0.5 },
    });
    const runId = runWithSpend(automation, 7.25);

    const decision = gateProposal(proposalFor(automation, runId));

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("$7.25");
    expect(decision.reason).toContain("ceiling");
  });

  it("stops auto-starting sessions once the day's budget is gone", () => {
    seedAppSettings({
      default_autonomy: "auto_merge",
      automation_daily_budget_usd: 2,
    });
    const automation = newAutomation({
      guardrails: { max_cost_usd_per_run: 100, confidence_threshold: 0.5 },
    });
    const runId = runWithSpend(automation, 3);

    const decision = gateProposal(proposalFor(automation, runId));

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("daily budget");
  });

  it("allows the same proposal when neither limit is reached", () => {
    const automation = newAutomation({
      guardrails: { max_cost_usd_per_run: 100, confidence_threshold: 0.5 },
    });
    const runId = runWithSpend(automation, 3);

    expect(gateProposal(proposalFor(automation, runId)).allowed).toBe(true);
  });
});
