/**
 * The connected computer's inbox — what its automations want you to decide.
 *
 * Same shape as `automationsStore`: host state, borrowed transport, polled by
 * the screen that shows it. Deciding is `control`-gated on the computer, so a
 * monitor-only phone reads the inbox and is refused the buttons.
 */

import { create } from "zustand";
import type { RemoteProposal } from "../lib/protocol";
import { useAppStore } from "./appStore";

interface ProposalsState {
  /** Pending only — a decided proposal leaves the inbox. */
  proposals: RemoteProposal[];
  /** Proposals with a decision in flight, so the card can go quiet. */
  busy: Record<string, true>;
  error: string | null;
  loaded: boolean;

  clear: () => void;
  refresh: () => Promise<void>;
  /** Start the work. Resolves to the agent doing it, so the caller can watch it. */
  accept: (proposalId: string) => Promise<string | null>;
  dismiss: (proposalId: string, reason?: string) => Promise<void>;
}

const message = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

export const useProposalsStore = create<ProposalsState>((set, get) => ({
  proposals: [],
  busy: {},
  error: null,
  loaded: false,

  clear: () => set({ proposals: [], busy: {}, error: null, loaded: false }),

  refresh: async () => {
    const t = useAppStore.getState().transport;
    if (!t) {
      return;
    }
    try {
      const { proposals } = await t.request<{ proposals: RemoteProposal[] }>(
        "proposals.list",
        { status: "pending" },
      );
      set({ proposals, error: null, loaded: true });
    } catch (err) {
      set({ error: message(err), loaded: true });
    }
  },

  accept: async (proposalId) => {
    const t = useAppStore.getState().transport;
    if (!t) {
      return null;
    }
    set((s) => ({ busy: { ...s.busy, [proposalId]: true } }));
    try {
      const { agent_id } = await t.request<{ agent_id: string }>(
        "proposals.accept",
        { proposal_id: proposalId },
      );
      // Accepting builds a worktree and starts an agent, which takes a while;
      // dropping the card now is the only honest thing to show meanwhile.
      set((s) => ({
        proposals: s.proposals.filter((p) => p.id !== proposalId),
        error: null,
      }));

      return agent_id;
    } catch (err) {
      set({ error: message(err) });

      return null;
    } finally {
      set((s) => {
        const busy = { ...s.busy };
        delete busy[proposalId];

        return { busy };
      });
    }
  },

  dismiss: async (proposalId, reason) => {
    const t = useAppStore.getState().transport;
    if (!t) {
      return;
    }
    set((s) => ({ busy: { ...s.busy, [proposalId]: true } }));
    try {
      await t.request("proposals.dismiss", {
        proposal_id: proposalId,
        ...(reason ? { reason } : {}),
      });
      set((s) => ({
        proposals: s.proposals.filter((p) => p.id !== proposalId),
        error: null,
      }));
    } catch (err) {
      set({ error: message(err) });
    } finally {
      set((s) => {
        const busy = { ...s.busy };
        delete busy[proposalId];

        return { busy };
      });
    }
    await get().refresh();
  },
}));

/** Drop the inbox when the phone switches computers — see `automationsStore`. */
useAppStore.subscribe((state, previous) => {
  if (state.activeHostId !== previous.activeHostId) {
    useProposalsStore.getState().clear();
  }
});
