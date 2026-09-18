/**
 * What holds a concurrency slot.
 *
 * The slot used to free when the agent stopped, which is the moment an
 * automation's branch starts waiting for a human — so a run could stack up
 * branches forever and never reach `max_concurrent_sessions`. A slot is now
 * held until the session is gone.
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

const { createAutomation, createRun, resetAutomationCache } =
  await import("./manager");
const { createProposal, resetProposalCache, updateProposal } =
  await import("./proposals/manager");
const { recordAutomationSession, resetOwnedSessionCache } =
  await import("./ownedSessions");
const { countActiveAutomationSessions } = await import("./autonomy");
const { gateProposal } = await import("./autoStart");

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

function newAutomation(): Automation {
  return createAutomation({
    name: "Grind through the backlog",
    playbook: "Start one session per issue. Do not stop.",
    trigger: { kind: "manual" },
    scope: { repo_roots: [repoRoot] },
    autonomy: "draft",
    guardrails: { max_concurrent_sessions: 1, confidence_threshold: 0.5 },
  });
}

/** A finished branch: the session still exists, its agent stopped long ago. */
function idleSession(automation: Automation, runId: string, id: string): void {
  appState.sessions.set(id, {
    id,
    kind: "worktree",
    branch: `argus/${id}`,
    display_name: id,
    description: "",
    path: repoRoot,
    repo_root: repoRoot,
    status: "ready",
  } as Session);
  appState.agents.set(`${id}-agent`, {
    agentId: `${id}-agent`,
    sessionId: id,
    status: "stopped",
    costUsd: 0,
  } as AgentSession);
  recordAutomationSession(automation.id, runId, id);
}

function proposalFor(automation: Automation, runId: string) {
  return createProposal({
    run_id: runId,
    automation_id: automation.id,
    title: "Next one",
    summary: "",
    confidence: 0.95,
    rationale: "",
    recommended_action: "start_session",
    repo_root: repoRoot,
  });
}

describe("concurrency slots", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-slots-"));
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "argus-slots-repo-"));
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

  it("keeps the slot while an unmerged branch sits there with a stopped agent", () => {
    const automation = newAutomation();
    const run = createRun(automation.id, "running", "manual");
    idleSession(automation, run.id, "branch-one");

    const decision = gateProposal(proposalFor(automation, run.id));

    expect(countActiveAutomationSessions(automation.id).forAutomation).toBe(1);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("in flight");
  });

  it("frees the slot when the session is merged away or deleted", () => {
    const automation = newAutomation();
    const run = createRun(automation.id, "running", "manual");
    idleSession(automation, run.id, "branch-one");

    appState.sessions.delete("branch-one");

    expect(countActiveAutomationSessions(automation.id).forAutomation).toBe(0);
    expect(gateProposal(proposalFor(automation, run.id)).allowed).toBe(true);
  });

  it("counts a session that is still coming up", () => {
    const automation = newAutomation();
    const run = createRun(automation.id, "running", "manual");
    const claimed = proposalFor(automation, run.id);
    updateProposal(claimed.id, { status: "auto_started" });

    expect(countActiveAutomationSessions(automation.id).forAutomation).toBe(1);
    expect(gateProposal(proposalFor(automation, run.id)).allowed).toBe(false);
  });

  it("counts sessions from earlier runs of the same automation", () => {
    const automation = newAutomation();
    const first = createRun(automation.id, "succeeded", "schedule");
    idleSession(automation, first.id, "yesterdays-branch");
    const second = createRun(automation.id, "running", "manual");

    expect(gateProposal(proposalFor(automation, second.id)).allowed).toBe(
      false,
    );
  });

  it("does not count another automation's sessions against this one", () => {
    const mine = newAutomation();
    const theirs = createAutomation({
      name: "Someone else",
      playbook: "x",
      trigger: { kind: "manual" },
      scope: { repo_roots: [repoRoot] },
      autonomy: "draft",
    });
    const theirRun = createRun(theirs.id, "running", "manual");
    idleSession(theirs, theirRun.id, "their-branch");
    const myRun = createRun(mine.id, "running", "manual");

    const counts = countActiveAutomationSessions(mine.id);

    expect(counts.forAutomation).toBe(0);
    expect(counts.total).toBe(1);
    expect(gateProposal(proposalFor(mine, myRun.id)).allowed).toBe(true);
  });
});
