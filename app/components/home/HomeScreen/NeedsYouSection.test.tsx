// @vitest-environment jsdom
/**
 * Home only earns the section when something is waiting, and it has to stay a
 * summary — past the cap it points at the inbox rather than growing.
 */

import type * as RouterModule from "../../../lib/router";
import type { AutomationRun, Proposal } from "../../../lib/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const markAutomationRunRead = vi.fn();
const appNavigate = vi.fn();

vi.mock("../../../lib/ipc", () => ({
  listProposals: () => Promise.resolve([]),
  acceptProposal: vi.fn(),
  requestProposalRevision: vi.fn(),
  dismissProposal: vi.fn(),
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
  markAutomationRunRead: (runId: string) => markAutomationRunRead(runId),
  startScratchRun: vi.fn(),
  saveScratchRunAsAutomation: vi.fn(),
  sendAutomationRunFeedback: vi.fn(),
  listScratchRuns: vi.fn(),
}));

vi.mock("../../../lib/transport", () => ({ subscribe: () => () => undefined }));

vi.mock("../../../lib/router", async (importOriginal) => ({
  ...(await importOriginal<typeof RouterModule>()),
  appNavigate: (route: unknown) => appNavigate(route),
}));

vi.mock("../../../stores/sessionStore", () => ({
  selectSession: vi.fn(),
  useSessions: () => [],
}));

const { setProposalState } = await import("../../../stores/proposalStore");
const { setAutomationState } = await import("../../../stores/automationStore");
const { NeedsYouSection } = await import("./NeedsYouSection");

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
    cta: {
      kind: "start_session",
      label: "Start work",
      url: null,
      branch: null,
      force: false,
      session_id: null,
    },
    source_ref: null,
    repo_root: "/Users/me/Work/argus",
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
    created_at: 1_000,
    ...patch,
  };
}

function failedRun(id: string): AutomationRun {
  return {
    id,
    automation_id: "a-1",
    scratch: null,
    status: "failed",
    trigger_reason: "schedule 09:00",
    started_at: Date.now() - 60_000,
    finished_at: Date.now(),
    host_session_id: null,
    host_agent_id: null,
    cost_usd: null,
    report_markdown: null,
    report_blocks: null,
    report_read: false,
    error: "The run's agent exited.",
  };
}

describe("needsYouSection", () => {
  beforeEach(() => {
    appNavigate.mockReset();
    markAutomationRunRead.mockReset();
    markAutomationRunRead.mockResolvedValue(undefined);
    setProposalState({ proposals: [], loading: false, error: null });
    setAutomationState({
      automations: [],
      runs: [],
      loading: false,
      error: null,
    });
  });

  it("stays out of the way when nothing is waiting", () => {
    const { container } = render(<NeedsYouSection />);
    expect(container.firstChild).toBeNull();
  });

  it("summarises a pending proposal rather than offering the decision", () => {
    setProposalState({ proposals: [proposal()], loading: false, error: null });
    render(<NeedsYouSection />);

    expect(
      screen.getByText("Fix the crash on a deleted worktree"),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: "Start work" })).toBeNull();
    expect(screen.getByText("1 waiting")).toBeDefined();
  });

  it("opens the proposal's own page when its summary is clicked", () => {
    setProposalState({ proposals: [proposal()], loading: false, error: null });
    render(<NeedsYouSection />);

    fireEvent.click(screen.getByText("Fix the crash on a deleted worktree"));

    expect(appNavigate).toHaveBeenCalledWith({
      view: "inbox",
      proposalId: "p-1",
    });
  });

  it("counts failed runs as waiting too", () => {
    setAutomationState({
      automations: [],
      runs: [failedRun("r-1")],
      loading: false,
      error: null,
    });
    render(<NeedsYouSection />);

    expect(screen.getByText("1 waiting")).toBeDefined();
    expect(screen.getByText("The run's agent exited.")).toBeDefined();
  });

  it("lets a failed run be dismissed from home", () => {
    setAutomationState({
      automations: [],
      runs: [failedRun("r-1")],
      loading: false,
      error: null,
    });
    render(<NeedsYouSection />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(markAutomationRunRead).toHaveBeenCalledWith("r-1");
  });

  it("drops a dismissed run from what is waiting", () => {
    setAutomationState({
      automations: [],
      runs: [{ ...failedRun("r-1"), report_read: true }],
      loading: false,
      error: null,
    });
    const { container } = render(<NeedsYouSection />);

    expect(container.firstChild).toBeNull();
  });

  it("points at the inbox rather than listing everything", () => {
    setProposalState({
      proposals: [
        proposal({ id: "p-1" }),
        proposal({ id: "p-2" }),
        proposal({ id: "p-3" }),
        proposal({ id: "p-4" }),
      ],
      loading: false,
      error: null,
    });
    render(<NeedsYouSection />);

    expect(screen.getByText("4 waiting")).toBeDefined();
    expect(screen.getByText("2 more in the inbox")).toBeDefined();
  });
});
