/**
 * Proposal persistence: the round trip, the `.bak` on a schema mismatch, and
 * the per-automation cap.
 */

import type { Proposal } from "./models";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { proposalsFilePath } from "../paths";
import {
  MAX_PROPOSALS_PER_AUTOMATION,
  loadProposals,
  saveProposals,
} from "./store";

let home: string;
let previousHome: string | undefined;

function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: "p1",
    run_id: "r1",
    automation_id: "a1",
    title: "Fix the null crash",
    summary: "It crashes on an empty list.",
    confidence: 0.8,
    rationale: "Two people are blocked on it.",
    recommended_action: "start_session",
    cta: {
      kind: "start_session",
      label: "Start",
      url: null,
      branch: null,
      force: false,
      session_id: null,
    },
    source_ref: {
      source_id: "github",
      external_id: "acme/app#412",
      url: "https://github.com/acme/app/issues/412",
    },
    repo_root: "/src/app",
    status: "pending",
    session_id: null,
    dismissed_reason: null,
    resolved_note: null,
    resolved_at: null,
    accepted_note: null,
    revision_request: null,
    revision_requested_at: null,
    cleared_reason: null,
    cleared_at: null,
    superseded_by: null,
    created_at: 1,
    ...overrides,
  };
}

describe("proposal store", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-proposals-"));
    process.env.ARGUS_HOME = home;
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env.ARGUS_HOME;
    } else {
      process.env.ARGUS_HOME = previousHome;
    }
    fs.rmSync(home, { force: true, recursive: true });
  });

  it("returns an empty list when nothing was ever written", () => {
    expect(loadProposals()).toEqual([]);
  });

  it("round-trips a proposal including its source ref", () => {
    saveProposals([proposal()]);
    expect(loadProposals()).toEqual([proposal()]);
  });

  it("round-trips a dismissal reason", () => {
    saveProposals([
      proposal({ status: "dismissed", dismissed_reason: "not our repo" }),
    ]);
    const [loaded] = loadProposals();
    expect(loaded.status).toBe("dismissed");
    expect(loaded.dismissed_reason).toBe("not our repo");
  });

  it("backs up and ignores a file written by a different schema", () => {
    const file = proposalsFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 99, proposals: [{}] }));

    expect(loadProposals()).toEqual([]);
    expect(fs.existsSync(`${file}.bak`)).toBe(true);
  });

  it("keeps only the newest proposals per automation", () => {
    const many = Array.from(
      { length: MAX_PROPOSALS_PER_AUTOMATION + 5 },
      (_, i) => proposal({ id: `p${i}`, created_at: i }),
    );
    const other = proposal({ id: "other", automation_id: "a2", created_at: 0 });

    const retained = saveProposals([...many, other]);
    expect(retained).toHaveLength(MAX_PROPOSALS_PER_AUTOMATION + 1);
    expect(retained.some((p) => p.id === "other")).toBe(true);
    expect(retained.some((p) => p.id === "p0")).toBe(false);
  });
});
