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
  supersedeProposals,
  withdrawProposal,
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

  describe("supersedeProposals", () => {
    it("points the old one at the new one and takes it out of the inbox", () => {
      const old = createProposal(input());
      const fresh = createProposal(input({ run_id: "r2" }));

      const cleared = supersedeProposals([old.id], fresh);

      expect(cleared).toEqual([
        {
          id: old.id,
          title: old.title,
          status: "superseded",
          reason: `Re-proposed as "${fresh.title}"`,
        },
      ]);
      resetProposalCache();
      const reloaded = listProposals().find((p) => p.id === old.id);
      expect(reloaded?.status).toBe("superseded");
      expect(reloaded?.superseded_by).toBe(fresh.id);
      expect(reloaded?.cleared_at).toBeGreaterThan(0);
    });

    it("refuses another automation's proposal, and one already decided", () => {
      const other = createProposal(input({ automation_id: "a2" }));
      const dismissed = createProposal(input());
      dismissProposal(dismissed.id, "no");
      const fresh = createProposal(input({ run_id: "r2" }));

      expect(
        supersedeProposals([other.id, dismissed.id, fresh.id], fresh),
      ).toEqual([]);
      expect(listProposals({ status: "superseded" })).toHaveLength(0);
    });
  });

  describe("withdrawProposal", () => {
    it("clears it with the run's reason, kept separate from a dismissal", () => {
      const proposal = createProposal(input());
      const withdrawn = withdrawProposal(
        proposal.id,
        " PR #6478 was merged on Tuesday ",
      );

      expect(withdrawn.status).toBe("withdrawn");
      expect(withdrawn.cleared_reason).toBe("PR #6478 was merged on Tuesday");
      expect(withdrawn.dismissed_reason).toBeNull();
    });

    it("refuses one the user already decided on", () => {
      const proposal = createProposal(input());
      dismissProposal(proposal.id, "not interested");

      expect(() => withdrawProposal(proposal.id, "gone")).toThrow();
    });
  });
});
