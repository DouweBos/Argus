// @vitest-environment jsdom
/**
 * The proposal page is where a decision is actually made, so it has to show
 * the whole proposal — and leave once the decision is taken.
 */

import type { Proposal } from "../../../lib/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dismissProposal = vi.fn();

vi.mock("../../../lib/ipc", () => ({
  listProposals: () => Promise.resolve([]),
  acceptProposal: vi.fn(),
  dismissProposal: (id: string, reason?: string) => dismissProposal(id, reason),
  openExternalUrl: vi.fn(),
  listAutomations: () => Promise.resolve([]),
  listAutomationRuns: () => Promise.resolve([]),
  createAutomation: vi.fn(),
  updateAutomation: vi.fn(),
  deleteAutomation: vi.fn(),
  deleteAutomationRun: vi.fn(),
  setAutomationEnabled: vi.fn(),
  runAutomationNow: vi.fn(),
  cancelAutomationRun: vi.fn(),
  getAutomationRun: vi.fn(),
  markAutomationRunRead: vi.fn(),
  startScratchRun: vi.fn(),
  saveScratchRunAsAutomation: vi.fn(),
  listScratchRuns: vi.fn(),
}));

vi.mock("../../../lib/transport", () => ({ subscribe: () => () => undefined }));

vi.mock("../../../stores/sessionStore", () => ({
  selectSession: vi.fn(),
  useSessions: () => [],
}));

const { setProposalState } = await import("../../../stores/proposalStore");
const { ProposalDetailScreen } = await import("./ProposalDetailScreen");

function proposal(patch: Partial<Proposal> = {}): Proposal {
  return {
    id: "p-1",
    run_id: "r-1",
    automation_id: "a-1",
    title: "Fix the crash on a deleted worktree",
    summary: "Reproduces every time.",
    confidence: 0.9,
    rationale: "Two-line fix.",
    recommended_action: "start_session",
    cta: { kind: "start_session", label: "Start work", url: null },
    source_ref: null,
    repo_root: "/Users/me/Work/argus",
    status: "pending",
    session_id: null,
    dismissed_reason: null,
    created_at: 1_000,
    ...patch,
  };
}

function renderAt(proposalId: string) {
  return render(
    <MemoryRouter initialEntries={[`/inbox/proposals/${proposalId}`]}>
      <ProposalDetailScreen />
    </MemoryRouter>,
  );
}

describe("proposalDetailScreen", () => {
  beforeEach(() => {
    dismissProposal.mockReset();
    dismissProposal.mockResolvedValue(proposal({ status: "dismissed" }));
    setProposalState({ proposals: [proposal()], loading: false, error: null });
  });

  it("shows the whole proposal, rationale included", () => {
    renderAt("p-1");

    expect(
      screen.getByText("Fix the crash on a deleted worktree"),
    ).toBeDefined();
    expect(screen.getByText("Reproduces every time.")).toBeDefined();
    expect(screen.getByText("Two-line fix.")).toBeDefined();
    expect(screen.getByRole("button", { name: /Start work/ })).toBeDefined();
  });

  it("says so when the proposal is no longer there", () => {
    renderAt("p-gone");
    expect(screen.getByText("This proposal is gone")).toBeDefined();
  });

  it("carries the dismiss reason to the backend", () => {
    renderAt("p-1");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    fireEvent.change(screen.getByLabelText("Why are you dismissing this?"), {
      target: { value: "not worth it" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(dismissProposal).toHaveBeenCalledWith("p-1", "not worth it");
  });
});
