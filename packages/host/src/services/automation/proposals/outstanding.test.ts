/**
 * The block every run is handed before it thinks. The point of the test is the
 * empty case: a heading over no proposals would invite the model to invent one.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProposal, dismissProposal, resetProposalCache } from "./manager";
import { outstandingBlock, proposalAge } from "./outstanding";

let home: string;
let previousHome: string | undefined;

function input(overrides: Record<string, unknown> = {}) {
  return {
    run_id: "r1",
    automation_id: "a1",
    title: "Get PR #6478 reviewed",
    summary: "It has been sitting at REVIEW_REQUIRED.",
    confidence: 0.7,
    rationale: "Nobody is looking at it.",
    recommended_action: "review" as const,
    ...overrides,
  };
}

describe("outstanding proposals", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-outstanding-"));
    process.env.ARGUS_HOME = home;
    resetProposalCache();
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env.ARGUS_HOME;
    } else {
      process.env.ARGUS_HOME = previousHome;
    }
    fs.rmSync(home, { force: true, recursive: true });
  });

  it("is null when this automation has nothing waiting", () => {
    const decided = createProposal(input());
    dismissProposal(decided.id, "no");
    createProposal(input({ automation_id: "a2" }));

    expect(outstandingBlock("a1")).toBeNull();
  });

  it("lists the id and the source so the run can supersede or withdraw it", () => {
    const pending = createProposal(
      input({
        source_ref: {
          source_id: "github",
          external_id: "plexinc/app#6478",
          url: "https://github.com/plexinc/app/pull/6478",
        },
      }),
    );

    const block = outstandingBlock("a1") ?? "";
    expect(block).toContain(pending.id);
    expect(block).toContain("plexinc/app#6478");
    expect(block).toContain("supersedes");
    expect(block).toContain("withdraw_proposal");
  });

  it("ages a proposal in the units that decide whether it is stale", () => {
    const now = Date.UTC(2026, 0, 10);
    expect(proposalAge(now - 60_000, now)).toBe("just now");
    expect(proposalAge(now - 3_600_000, now)).toBe("1 hour ago");
    expect(proposalAge(now - 4 * 86_400_000, now)).toBe("4 days ago");
  });
});
