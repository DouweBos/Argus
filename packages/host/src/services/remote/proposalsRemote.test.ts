/**
 * What a phone is told about the inbox, and what deciding from one does.
 *
 * Accepting is deliberately not exercised here — it builds a worktree and
 * starts an agent, and it is the desktop's own `acceptProposal` either way.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createProposal,
  resetProposalCache,
} from "../automation/proposals/manager";
import {
  dismissRemoteProposal,
  remoteProposal,
  remoteProposals,
} from "./proposalsRemote";

let home: string;
let previousHome: string | undefined;

function proposal(overrides: Record<string, unknown> = {}) {
  return createProposal({
    run_id: "r1",
    automation_id: "a1",
    title: "Fix the null crash",
    summary: "It crashes on an empty list.",
    confidence: 0.8,
    rationale: "Two people are blocked on it.",
    recommended_action: "start_session" as const,
    repo_root: "/Users/me/Work/aurora",
    source_ref: {
      source_id: "github",
      external_id: "aurora#412",
      url: "https://github.com/x/aurora/issues/412",
    },
    ...overrides,
  });
}

describe("the inbox a phone sees", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-remote-proposals-"));
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
    resetProposalCache();
  });

  it("sends a project name, never a path", () => {
    proposal();

    const [sent] = remoteProposals({}).proposals;

    expect(sent.project).toBe("aurora");
    expect(JSON.stringify(sent)).not.toContain("/Users/me");
  });

  it("carries the source and the button the run asked for", () => {
    proposal();

    const [sent] = remoteProposals({}).proposals;

    expect(sent.source_label).toBe("aurora#412");
    expect(sent.source_url).toBe("https://github.com/x/aurora/issues/412");
    expect(sent.cta?.kind).toBe("start_session");
  });

  it("narrows to what is still waiting", () => {
    const decided = proposal();
    proposal({ title: "Still waiting" });
    dismissRemoteProposal(decided.id, "not worth it");

    const pending = remoteProposals({ status: "pending" }).proposals;

    expect(pending.map((p) => p.title)).toEqual(["Still waiting"]);
  });

  it("keeps the dismiss reason — it is what teaches the automation", () => {
    const created = proposal();

    const dismissed = dismissRemoteProposal(
      created.id,
      "agents stay out of payments",
    );

    expect(dismissed?.proposal.status).toBe("dismissed");
    expect(remoteProposals({ status: "dismissed" }).proposals).toHaveLength(1);
  });

  it("says nothing about a proposal it does not have", () => {
    expect(dismissRemoteProposal("no-such-proposal")).toBeNull();
  });

  it("carries the record behind a decision for the proposal's own screen", () => {
    const decided = proposal();
    dismissRemoteProposal(decided.id, "not worth it");

    const sent = remoteProposal(decided.id)?.proposal;

    expect(sent?.status).toBe("dismissed");
    expect(sent?.dismissed_reason).toBe("not worth it");
    expect(sent?.superseded_by).toBeNull();
    expect(remoteProposal("nope")).toBeNull();
  });
});
