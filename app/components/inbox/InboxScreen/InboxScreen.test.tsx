// @vitest-environment jsdom
/**
 * The inbox has two jobs: read as calm when there is nothing to do, and make
 * the dismiss reason cheap enough to actually type — it is the only feedback
 * the automation ever gets.
 */

import type { Proposal } from "../../../lib/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dismissProposal = vi.fn();
const acceptProposal = vi.fn();
const openExternalUrl = vi.fn();

vi.mock("../../../lib/ipc", () => ({
  listProposals: () => Promise.resolve([]),
  acceptProposal: (id: string) => acceptProposal(id),
  dismissProposal: (id: string, reason?: string) => dismissProposal(id, reason),
  openExternalUrl: (url: string) => openExternalUrl(url),
  getSessionCommitsAhead: () => Promise.resolve(0),
  listAutomations: () => Promise.resolve([]),
  listAutomationRuns: () => Promise.resolve([]),
  createAutomation: vi.fn(),
  updateAutomation: vi.fn(),
  deleteAutomation: vi.fn(),
  setAutomationEnabled: vi.fn(),
  runAutomationNow: vi.fn(),
  cancelAutomationRun: vi.fn(),
  getAutomationRun: vi.fn(),
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
const { setAutomationState } = await import("../../../stores/automationStore");
const { InboxScreen } = await import("./InboxScreen");

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
    source_ref: {
      external_id: "argus#412",
      source_id: "github",
      url: "https://github.com/x/argus/issues/412",
    },
    repo_root: "/Users/me/Work/argus",
    status: "pending",
    session_id: null,
    dismissed_reason: null,
    created_at: 1_000,
    ...patch,
  };
}

describe("inboxScreen", () => {
  beforeEach(() => {
    dismissProposal.mockReset();
    dismissProposal.mockResolvedValue(proposal({ status: "dismissed" }));
    acceptProposal.mockReset();
    acceptProposal.mockResolvedValue({
      agent_id: "ag-1",
      session_id: "s-1",
      proposal: proposal({ status: "accepted" }),
    });
    openExternalUrl.mockReset();
    openExternalUrl.mockResolvedValue(undefined);
    setProposalState({ proposals: [], loading: false, error: null });
    setAutomationState({
      automations: [],
      runs: [],
      loading: false,
      error: null,
    });
  });

  it("reads as calm when there is nothing waiting", () => {
    render(<InboxScreen />);
    expect(screen.getByText("Nothing needs you")).toBeDefined();
    expect(screen.getByText("No decisions waiting")).toBeDefined();
  });

  it("lists a pending proposal with its three actions", () => {
    setProposalState({ proposals: [proposal()], loading: false, error: null });
    render(<InboxScreen />);

    expect(
      screen.getByText("Fix the crash on a deleted worktree"),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: /Start/ })).toBeDefined();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /argus#412/ }));
    expect(openExternalUrl).toHaveBeenCalledWith(
      "https://github.com/x/argus/issues/412",
    );
  });

  it("carries the dismiss reason to the backend", () => {
    setProposalState({ proposals: [proposal()], loading: false, error: null });
    render(<InboxScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    fireEvent.change(screen.getByLabelText("Why are you dismissing this?"), {
      target: { value: "agents stay out of payments" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(dismissProposal).toHaveBeenCalledWith(
      "p-1",
      "agents stay out of payments",
    );
  });

  it("dismisses without a reason rather than demanding one", () => {
    setProposalState({ proposals: [proposal()], loading: false, error: null });
    render(<InboxScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(dismissProposal).toHaveBeenCalledWith("p-1", undefined);
  });

  it("puts decisions above work already under way", () => {
    setProposalState({
      proposals: [
        proposal({ id: "p-2", status: "auto_started", session_id: "s-1" }),
        proposal({ id: "p-1", title: "Decide me" }),
      ],
      loading: false,
      error: null,
    });
    const { container } = render(<InboxScreen />);
    const headings = Array.from(
      container.querySelectorAll("section > header"),
    ).map((h) => h.textContent);
    expect(headings[0]).toContain("Decide");
    expect(headings[1]).toContain("Argus is on it");
  });
});
