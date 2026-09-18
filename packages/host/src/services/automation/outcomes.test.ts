/**
 * The calibration loop, end to end on real files: a proposal is emitted,
 * decided, and — when it became work — the session's fate is observed off the
 * bus. The prompt block is the payload, so its shape is asserted too.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emitHostEvent, resetHostEventSinks } from "@argus/host/bus";
import {
  calibrationBlock,
  calibrationFor,
  initAutomationOutcomes,
  listOutcomes,
  recordSessionOutcome,
  resetOutcomeCache,
  stopAutomationOutcomes,
} from "./outcomes";
import {
  createProposal,
  dismissProposal,
  resetProposalCache,
  updateProposal,
} from "./proposals/manager";

let home: string;
let previousHome: string | undefined;

const AUTOMATION = "a1";

function emit(title: string, confidence = 0.9) {
  return createProposal({
    run_id: "r1",
    automation_id: AUTOMATION,
    title,
    summary: "…",
    confidence,
    rationale: "…",
    recommended_action: "start_session",
    repo_root: "/src/app",
  });
}

describe("automation outcomes", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-outcomes-"));
    process.env.ARGUS_HOME = home;
    resetProposalCache();
    resetOutcomeCache();
    resetHostEventSinks();
  });

  afterEach(() => {
    stopAutomationOutcomes();
    resetHostEventSinks();
    if (previousHome === undefined) {
      delete process.env.ARGUS_HOME;
    } else {
      process.env.ARGUS_HOME = previousHome;
    }
    fs.rmSync(home, { force: true, recursive: true });
  });

  it("has nothing to say before an automation has proposed anything", () => {
    expect(calibrationFor(AUTOMATION).sample).toBe(0);
    expect(calibrationFor(AUTOMATION).acceptance_rate).toBeNull();
    expect(calibrationBlock(AUTOMATION)).toBeNull();
  });

  it("counts accepted, auto-started and dismissed proposals", () => {
    updateProposal(emit("one").id, { status: "accepted", session_id: "s1" });
    updateProposal(emit("two").id, {
      status: "auto_started",
      session_id: "s2",
    });
    dismissProposal(emit("three").id, "touched the payments module");
    emit("four");

    const c = calibrationFor(AUTOMATION);
    expect(c).toMatchObject({
      sample: 4,
      accepted: 1,
      auto_started: 1,
      dismissed: 1,
      pending: 1,
    });
    // Pending is not a verdict, so it stays out of the rate.
    expect(c.acceptance_rate).toBeCloseTo(2 / 3);
    expect(c.dismissals).toEqual([
      { title: "three", reason: "touched the payments module" },
    ]);
  });

  it("records a merge from the bus and keeps it when the worktree is cleaned up", () => {
    const proposal = emit("one");
    updateProposal(proposal.id, { status: "accepted", session_id: "s1" });
    initAutomationOutcomes();

    emitHostEvent("session:merged", {
      sessionId: "s1",
      branch: "feat/x",
      baseBranch: "main",
    });
    emitHostEvent("session:deleted", "s1");

    expect(listOutcomes(AUTOMATION)).toHaveLength(1);
    expect(calibrationFor(AUTOMATION)).toMatchObject({
      merged: 1,
      abandoned: 0,
    });
  });

  it("records a session deleted without a merge as abandoned", () => {
    const proposal = emit("one");
    updateProposal(proposal.id, { status: "auto_started", session_id: "s9" });
    initAutomationOutcomes();

    emitHostEvent("session:deleted", "s9");

    expect(calibrationFor(AUTOMATION)).toMatchObject({
      merged: 0,
      abandoned: 1,
    });
  });

  it("ignores sessions no proposal ever started", () => {
    initAutomationOutcomes();
    emitHostEvent("session:deleted", "unrelated");
    expect(listOutcomes()).toEqual([]);
  });

  it("survives a restart", () => {
    updateProposal(emit("one").id, { status: "accepted", session_id: "s1" });
    recordSessionOutcome("s1", "merged");

    resetOutcomeCache();
    expect(listOutcomes(AUTOMATION)).toMatchObject([{ outcome: "merged" }]);
  });

  describe("the prompt block", () => {
    it("states the tally, quotes the dismissals and names the session fates", () => {
      updateProposal(emit("Fix the crash").id, {
        status: "accepted",
        session_id: "s1",
      });
      dismissProposal(
        emit("Rewrite payments").id,
        "I don't want agents in there",
      );
      recordSessionOutcome("s1", "merged");

      const block = calibrationBlock(AUTOMATION) ?? "";
      expect(block).toContain("## Calibration");
      expect(block).toContain("Your last 2 proposal(s)");
      expect(block).toContain("1 accepted");
      expect(block).toContain("1 dismissed");
      expect(block).toContain("1 merged");
      expect(block).toContain(
        `- "Rewrite payments" — I don't want agents in there`,
      );
    });

    it("says so plainly when most of what it proposed was rejected", () => {
      updateProposal(emit("kept").id, { status: "accepted", session_id: "s1" });
      dismissProposal(emit("no").id, "not now");
      dismissProposal(emit("also no").id, "not now either");

      expect(calibrationBlock(AUTOMATION)).toContain(
        "Most of what you proposed was rejected",
      );
    });
  });
});
