// @vitest-environment jsdom
/**
 * The inbox never polls: the host pushes the whole proposal list on
 * `proposals:changed`, and dismissing one carries its reason to the backend
 * verbatim — that reason is the only training signal the loop gets.
 */

import type { Proposal } from "../lib/types";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (payload: unknown, hostId: string) => void;

const listeners = new Map<string, Set<Listener>>();

function emit(event: string, payload: unknown): void {
  for (const listener of listeners.get(event) ?? []) {
    listener(payload, "local");
  }
}

vi.mock("../lib/transport", () => ({
  subscribe: (event: string, cb: Listener) => {
    const set = listeners.get(event) ?? new Set<Listener>();
    set.add(cb);
    listeners.set(event, set);

    return () => set.delete(cb);
  },
}));

const listProposals = vi.fn<() => Promise<Proposal[]>>();
const dismiss = vi.fn();

vi.mock("../lib/ipc", () => ({
  listProposals: () => listProposals(),
  acceptProposal: vi.fn(),
  requestProposalRevision: vi.fn(),
  dismissProposal: (id: string, reason?: string) => dismiss(id, reason),
}));

vi.mock("../lib/routeHooks", () => ({ useRouteHostId: () => "local" }));

const {
  dismissProposal,
  getProposalState,
  setProposalState,
  usePendingProposals,
  useProposalsSync,
  useStartedProposals,
} = await import("./proposalStore");

function proposal(id: string, patch: Partial<Proposal> = {}): Proposal {
  return {
    id,
    run_id: "r-1",
    automation_id: "a-1",
    title: `Proposal ${id}`,
    summary: "",
    confidence: 0.9,
    rationale: "",
    recommended_action: "start_session",
    cta: {
      kind: "start_session",
      label: "Start",
      url: null,
      branch: null,
      force: false,
      session_id: null,
    },
    source_ref: null,
    repo_root: null,
    status: "pending",
    session_id: null,
    dismissed_reason: null,
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

describe("proposal store", () => {
  beforeEach(() => {
    listeners.clear();
    listProposals.mockReset();
    listProposals.mockResolvedValue([]);
    dismiss.mockReset();
    dismiss.mockResolvedValue(proposal("p-1", { status: "dismissed" }));
    setProposalState({ proposals: [], loading: false, error: null });
  });

  it("loads the list once and then listens", async () => {
    listProposals.mockResolvedValue([proposal("p-1")]);
    renderHook(() => useProposalsSync());

    await waitFor(() => expect(getProposalState().proposals).toHaveLength(1));
    expect(listProposals).toHaveBeenCalledTimes(1);
  });

  it("replaces the list from proposals:changed", async () => {
    renderHook(() => useProposalsSync());
    await waitFor(() => expect(listProposals).toHaveBeenCalled());

    act(() => emit("proposals:changed", [proposal("p-1"), proposal("p-2")]));
    expect(getProposalState().proposals.map((p) => p.id)).toEqual([
      "p-1",
      "p-2",
    ]);

    act(() => emit("proposals:changed", [proposal("p-2")]));
    expect(getProposalState().proposals).toHaveLength(1);
  });

  it("sorts newest first whatever order the host sends", async () => {
    renderHook(() => useProposalsSync());
    act(() =>
      emit("proposals:changed", [
        proposal("old", { created_at: 1 }),
        proposal("new", { created_at: 9 }),
      ]),
    );
    expect(getProposalState().proposals[0].id).toBe("new");
  });

  it("separates decisions from work already under way", async () => {
    renderHook(() => useProposalsSync());
    const pending = renderHook(() => usePendingProposals());
    const started = renderHook(() => useStartedProposals());

    act(() =>
      emit("proposals:changed", [
        proposal("p-1"),
        proposal("p-2", { status: "auto_started", session_id: "s-1" }),
        proposal("p-3", { status: "dismissed" }),
        // Accepted but session-less: not something to review yet.
        proposal("p-4", { status: "accepted" }),
      ]),
    );

    expect(pending.result.current.map((p) => p.id)).toEqual(["p-1"]);
    expect(started.result.current.map((p) => p.id)).toEqual(["p-2"]);
  });

  it("passes the dismiss reason through, and omits an empty one", async () => {
    await dismissProposal("p-1", "touches payments, not for agents");
    expect(dismiss).toHaveBeenCalledWith(
      "p-1",
      "touches payments, not for agents",
    );

    await dismissProposal("p-1");
    expect(dismiss).toHaveBeenLastCalledWith("p-1", undefined);
  });
});
