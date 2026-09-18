/**
 * The inbox's write path: proposals land pending, dismissals keep their reason
 * across a reload, and every mutation publishes on the bus.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addHostEventSink, resetHostEventSinks } from "@argus/host/bus";
import {
  createProposal,
  deleteProposalsForAutomation,
  dismissProposal,
  listProposals,
  resetProposalCache,
} from "./manager";

let home: string;
let previousHome: string | undefined;

function input(overrides: Record<string, unknown> = {}) {
  return {
    run_id: "r1",
    automation_id: "a1",
    title: "Fix the null crash",
    summary: "It crashes on an empty list.",
    confidence: 0.8,
    rationale: "Two people are blocked on it.",
    recommended_action: "start_session" as const,
    repo_root: "/src/app",
    ...overrides,
  };
}

describe("proposal manager", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-proposals-mgr-"));
    process.env.ARGUS_HOME = home;
    resetProposalCache();
    resetHostEventSinks();
  });

  afterEach(() => {
    resetHostEventSinks();
    if (previousHome === undefined) {
      delete process.env.ARGUS_HOME;
    } else {
      process.env.ARGUS_HOME = previousHome;
    }
    fs.rmSync(home, { force: true, recursive: true });
  });

  describe("createProposal", () => {
    it("lands pending even when the agent recommended starting a session", () => {
      const proposal = createProposal(input());
      expect(proposal.status).toBe("pending");
      expect(proposal.session_id).toBeNull();
    });

    it("clamps a confidence the agent invented outside 0..1", () => {
      expect(createProposal(input({ confidence: 4 })).confidence).toBe(1);
      expect(createProposal(input({ confidence: -2 })).confidence).toBe(0);
      expect(createProposal(input({ confidence: Number.NaN })).confidence).toBe(
        0,
      );
    });

    it("publishes the new list on proposals:changed", () => {
      const sink = vi.fn();
      addHostEventSink(sink);
      createProposal(input());

      expect(sink).toHaveBeenCalledWith("proposals:changed", [
        expect.arrayContaining([
          expect.objectContaining({ status: "pending" }),
        ]),
      ]);
    });
  });

  describe("dismissProposal", () => {
    it("persists the reason across a reload — it is the training signal", () => {
      const proposal = createProposal(input());
      dismissProposal(proposal.id, "  I don't want agents in payments  ");

      resetProposalCache();
      const [reloaded] = listProposals();
      expect(reloaded.status).toBe("dismissed");
      expect(reloaded.dismissed_reason).toBe("I don't want agents in payments");
    });

    it("stores null when no reason was given", () => {
      const proposal = createProposal(input());
      expect(dismissProposal(proposal.id).dismissed_reason).toBeNull();
    });

    it("throws for an unknown id", () => {
      expect(() => dismissProposal("nope")).toThrow();
    });
  });

  describe("listProposals", () => {
    it("filters by automation, run and status", () => {
      createProposal(input({ automation_id: "a1", run_id: "r1" }));
      const other = createProposal(
        input({ automation_id: "a2", run_id: "r2" }),
      );
      dismissProposal(other.id, "nope");

      expect(listProposals({ automationId: "a1" })).toHaveLength(1);
      expect(listProposals({ runId: "r2" })).toHaveLength(1);
      expect(listProposals({ status: "pending" })).toHaveLength(1);
    });

    it("drops an automation's proposals when it is deleted", () => {
      createProposal(input({ automation_id: "a1" }));
      createProposal(input({ automation_id: "a2" }));
      deleteProposalsForAutomation("a1");

      expect(listProposals().map((p) => p.automation_id)).toEqual(["a2"]);
    });
  });
});
