/**
 * Proposals — the inbox's decisions, as the focused host sees them.
 *
 * Host state, not renderer state: the backend owns the list and pushes the
 * whole of it on `proposals:changed`, so nothing here polls. Accepting a
 * proposal is a backend operation (it creates the session and spawns the
 * agent); this store only asks for it and follows the user to the result.
 */

import type { HostId } from "../lib/transport/hostId";
import type { Proposal } from "../lib/types";
import { useEffect } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { useIpcEvent } from "../hooks/useIpcEvent";
import {
  acceptProposal as acceptProposalIpc,
  dismissProposal as dismissProposalIpc,
  listProposals,
} from "../lib/ipc";
import { useRouteHostId } from "../lib/routeHooks";
import { appNavigate } from "../lib/router";

interface ProposalStoreData {
  error: string | null;
  loading: boolean;
  proposals: Proposal[];
}

const store = create<ProposalStoreData>(() => ({
  proposals: [],
  loading: false,
  error: null,
}));

function byNewest(proposals: Proposal[]): Proposal[] {
  return [...proposals].sort((a, b) => b.created_at - a.created_at);
}

/** Replace the whole list — the payload of `proposals:changed`. */
export function applyProposalsChanged(proposals: Proposal[]): void {
  store.setState({ proposals: byNewest(proposals) });
}

/** Load every proposal from a host. Safe to call repeatedly. */
export async function refreshProposals(): Promise<void> {
  store.setState({ loading: true, error: null });
  try {
    store.setState({
      proposals: byNewest(await listProposals()),
      loading: false,
      error: null,
    });
  } catch (e) {
    store.setState({
      loading: false,
      error: typeof e === "string" ? e : String(e),
    });
  }
}

/**
 * Keep the cache in step with the focused host. Mounted once in the app shell
 * so the inbox badge is right before the inbox has ever been opened.
 */
export function useProposalsSync(): void {
  const hostId = useRouteHostId();

  useEffect(() => {
    store.setState({ proposals: [] });
    refreshProposals().catch(() => undefined);
  }, [hostId]);

  useIpcEvent<Proposal[]>("proposals:changed", applyProposalsChanged, hostId);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const useProposals = (): Proposal[] => store((s) => s.proposals);

export const useProposalsLoading = (): boolean => store((s) => s.loading);

export const useProposalsError = (): string | null => store((s) => s.error);

/** Waiting on a decision — the only group that outranks everything else. */
export const usePendingProposals = (): Proposal[] =>
  store(useShallow((s) => s.proposals.filter((p) => p.status === "pending")));

/** Work Argus already started, or that you started from here. */
export const useStartedProposals = (): Proposal[] =>
  store(
    useShallow((s) =>
      s.proposals.filter(
        (p) =>
          (p.status === "accepted" || p.status === "auto_started") &&
          p.session_id !== null,
      ),
    ),
  );

/**
 * Cleared by a later run rather than by you — shown for a day so a proposal
 * never just vanishes out of the inbox unexplained.
 */
export const CLEARED_WINDOW_MS = 24 * 60 * 60 * 1000;

export const useClearedProposals = (): Proposal[] =>
  store(
    useShallow((s) =>
      s.proposals.filter(
        (p) =>
          (p.status === "superseded" || p.status === "withdrawn") &&
          p.cleared_at !== null &&
          Date.now() - p.cleared_at < CLEARED_WINDOW_MS,
      ),
    ),
  );

export const useProposal = (id: string | null): Proposal | null =>
  store((s) => (id ? (s.proposals.find((p) => p.id === id) ?? null) : null));

/** For tests. */
export const getProposalState = () => store.getState();
export const setProposalState = store.setState.bind(store);

// ---------------------------------------------------------------------------
// Writes — the backend emits, so neither patches the cache by hand.
// ---------------------------------------------------------------------------

export const acceptProposal = acceptProposalIpc;

export const dismissProposal = (
  id: string,
  reason?: string,
): Promise<Proposal> => dismissProposalIpc(id, reason);

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export function openInbox(hostId?: HostId): void {
  appNavigate({ view: "inbox", ...(hostId ? { hostId } : {}) });
}

/** `/inbox/proposals/:id` — the proposal in full, where it can be decided. */
export function openProposal(id: string, hostId?: HostId): void {
  appNavigate({ view: "inbox", proposalId: id, ...(hostId ? { hostId } : {}) });
}
