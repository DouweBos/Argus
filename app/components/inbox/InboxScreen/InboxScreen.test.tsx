// @vitest-environment jsdom
/**
 * The inbox has two jobs: read as calm when there is nothing to do, and make
 * the dismiss reason cheap enough to actually type — it is the only feedback
 * the automation ever gets.
 */

import type { AutomationRun, Proposal } from "../../../lib/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dismissProposal = vi.fn();
const acceptProposal = vi.fn();
const requestProposalRevision = vi.fn();
const openExternalUrl = vi.fn();

vi.mock("../../../lib/ipc", () => ({
  listProposals: () => Promise.resolve([]),
  acceptProposal: (id: string, note?: string) => acceptProposal(id, note),
  requestProposalRevision: (id: string, note: string) =>
    requestProposalRevision(id, note),
  dismissProposal: (id: string, reason?: string) => dismissProposal(id, reason),
  openExternalUrl: (url: string) => openExternalUrl(url),
  getSessionCommitsAhead: () => Promise.resolve(0),
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
  sendAutomationRunFeedback: vi.fn(),
  listScratchRuns: vi.fn(),
}));

vi.mock("../../../lib/transport", () => ({ subscribe: () => () => undefined }));

vi.mock("../../../stores/sessionStore", () => ({
  selectSession: vi.fn(),
  useSessions: () => [
    { id: "s-1", repo_root: "/work/app", branch: "fix-flake" },
  ],
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
    cta: {
      kind: "start_session",
      label: "Start",
      url: null,
      branch: null,
      force: false,
      session_id: null,
    },
    source_ref: {
      external_id: "argus#412",
      source_id: "github",
      url: "https://github.com/x/argus/issues/412",
    },
    repo_root: "/Users/me/Work/argus",
    status: "pending",
    session_id: null,
    agent_id: null,
    start_stage: null,
    start_error: null,
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

function run(patch: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: "r-1",
    automation_id: "a-1",
    scratch: null,
    status: "succeeded",
    trigger_reason: "schedule 07:30",
    started_at: Date.now() - 60_000,
    finished_at: Date.now(),
    host_session_id: null,
    host_agent_id: null,
    cost_usd: null,
    report_markdown: "## Standup\nTwo PRs landed overnight.",
    report_blocks: null,
    error: null,
    report_read: false,
    feedback: [],
    ...patch,
  };
}

describe("inboxScreen", () => {
  beforeEach(() => {
    dismissProposal.mockReset();
    dismissProposal.mockResolvedValue(proposal({ status: "dismissed" }));
    acceptProposal.mockReset();
    requestProposalRevision.mockReset();
    requestProposalRevision.mockResolvedValue({
      proposal: proposal(),
      run_started: true,
    });
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

  it("shows where a start has got to instead of its actions", () => {
    setProposalState({
      proposals: [proposal({ start_stage: "setting_up" })],
      loading: false,
      error: null,
    });
    render(<InboxScreen />);

    expect(screen.getByText("Running setup…")).toBeDefined();
    expect(screen.queryByRole("button", { name: /Start/ })).toBeNull();
  });

  it("says why the last start failed and offers to try again", () => {
    setProposalState({
      proposals: [proposal({ start_error: "mise.toml is not trusted." })],
      loading: false,
      error: null,
    });
    render(<InboxScreen />);

    expect(screen.getByRole("alert").textContent).toContain(
      "mise.toml is not trusted.",
    );
    expect(screen.getByRole("button", { name: /Try again/ })).toBeDefined();
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

  it("starts a proposal with the note the user added", () => {
    setProposalState({ proposals: [proposal()], loading: false, error: null });
    render(<InboxScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
    fireEvent.change(screen.getByLabelText("Add a note to this proposal"), {
      target: { value: "right fix, but do it in the host package" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Start with this note/ }),
    );

    expect(acceptProposal).toHaveBeenCalledWith(
      "p-1",
      "right fix, but do it in the host package",
    );
  });

  it("sends the note back to the automation when asked for a better one", () => {
    setProposalState({ proposals: [proposal()], loading: false, error: null });
    render(<InboxScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
    fireEvent.change(screen.getByLabelText("Add a note to this proposal"), {
      target: { value: "scope it to the flaky test, not the whole suite" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Ask for a better one" }),
    );

    expect(requestProposalRevision).toHaveBeenCalledWith(
      "p-1",
      "scope it to the flaky test, not the whole suite",
    );
    expect(acceptProposal).not.toHaveBeenCalled();
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

  it("drops started work whose session was merged or deleted", () => {
    setProposalState({
      proposals: [
        proposal({ id: "p-2", status: "auto_started", session_id: "gone" }),
      ],
      loading: false,
      error: null,
    });
    render(<InboxScreen />);

    expect(screen.queryByText("Argus is on it")).toBeNull();
  });

  it("lists an unread report so nobody has to hunt for it in Automations", () => {
    setAutomationState({
      automations: [],
      runs: [run()],
      loading: false,
      error: null,
    });
    render(<InboxScreen />);

    expect(screen.getByText("Standup")).toBeDefined();
    expect(screen.getByRole("button", { name: "Mark read" })).toBeDefined();
  });

  it("leaves a failed run to the failures section rather than listing it twice", () => {
    setAutomationState({
      automations: [],
      runs: [run({ status: "failed", error: "Agent exited 1" })],
      loading: false,
      error: null,
    });
    render(<InboxScreen />);

    expect(screen.getByText("Agent exited 1")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Mark read" })).toBeNull();
  });

  it("says what a later run cleared, rather than dropping it silently", () => {
    setProposalState({
      proposals: [
        proposal({
          id: "p-3",
          title: "Get PR #6478 reviewed",
          status: "withdrawn",
          cleared_reason: "PR #6478 was merged on Tuesday",
          cleared_at: Date.now() - 60_000,
        }),
      ],
      loading: false,
      error: null,
    });
    render(<InboxScreen />);

    expect(screen.getByText("Get PR #6478 reviewed")).toBeDefined();
    expect(screen.getByText(/merged on Tuesday/)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  });

  it("forgets a cleared proposal once it is a day old", () => {
    setProposalState({
      proposals: [
        proposal({
          id: "p-4",
          status: "superseded",
          cleared_reason: "Re-proposed today",
          cleared_at: Date.now() - 25 * 60 * 60 * 1000,
        }),
      ],
      loading: false,
      error: null,
    });
    render(<InboxScreen />);

    expect(screen.getByText("Nothing needs you")).toBeDefined();
  });
});
