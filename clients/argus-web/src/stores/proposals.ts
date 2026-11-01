/**
 * The inbox's proposals: what the computer's automations want decided.
 * Mirrors ArgusCore's `ProposalsStore`. Reading is `monitor`; every decision
 * needs `control`, because starting one builds a worktree and the dismiss
 * reason is what calibrates the automation.
 */

import type { RemoteProposal } from "@argus/remote-protocol";
import { create } from "zustand";
import {
  describeError,
  INITIAL_LOAD,
  isQuietError,
  isTransientError,
  type LoadState,
} from "@argus/client-core";
import { request } from "../lib/request";
import { capture } from "../telemetry/telemetry";
import { currentTransport } from "./connection";
import type { RefreshOptions } from "./projects";

interface ProposalsState {
  /** Pending, newest first: the decisions. */
  pending: RemoteProposal[];
  /** The newest in any state, for the started and cleared groups. */
  recent: RemoteProposal[];
  load: LoadState;
  /** A failed decision, for the screen's banner. */
  error: string | null;
  /** A dismiss, resolve, revision or cleanup in flight: the card dims. */
  busy: string[];
  /** Accepts asked for here and not yet answered. */
  requesting: string[];
  /** Why an accept itself failed; the host's `start_error` covers the rest. */
  requestErrors: Record<string, string>;
  /** Proposals opened on their own screen, decided ones included; null is gone. */
  detailById: Record<string, RemoteProposal | null>;

  refresh: (options?: RefreshOptions) => Promise<void>;
  /** One proposal in full, for its own screen. */
  loadProposal: (id: string) => Promise<void>;
  /** The agent it started, when the start finished inside the request. */
  accept: (
    id: string,
    note?: string,
  ) => Promise<{ agentId: string; sessionId: string } | null>;
  dismiss: (id: string, reason?: string) => Promise<boolean>;
  resolve: (id: string, note?: string) => Promise<boolean>;
  /** Whether a run started now; a note the next run picks up is as good. */
  requestRevision: (id: string, note: string) => Promise<boolean | null>;
  performCleanup: (id: string) => Promise<boolean>;
  clearError: () => void;
}

const EMPTY = {
  pending: [],
  recent: [],
  load: INITIAL_LOAD,
  error: null,
  busy: [],
  requesting: [],
  requestErrors: {},
  detailById: {},
} satisfies Partial<ProposalsState>;

export const useProposalsStore = create<ProposalsState>()((set, get) => {
  function replace(proposal: RemoteProposal): void {
    set((s) => ({
      detailById: { ...s.detailById, [proposal.id]: proposal },
      pending:
        proposal.status === "pending"
          ? s.pending.map((p) => (p.id === proposal.id ? proposal : p))
          : s.pending.filter((p) => p.id !== proposal.id),
      recent: s.recent.some((p) => p.id === proposal.id)
        ? s.recent.map((p) => (p.id === proposal.id ? proposal : p))
        : [proposal, ...s.recent],
    }));
  }

  /** A decision that changes the record: dim the card, land the answer, refresh. */
  async function decide(
    id: string,
    summary: string,
    call: () => Promise<RemoteProposal>,
  ): Promise<boolean> {
    set((s) => ({ busy: [...s.busy, id], error: null }));
    try {
      replace(await call());

      return true;
    } catch (err) {
      set({ error: `${summary} — ${describeError(err)}` });

      return false;
    } finally {
      set((s) => ({ busy: s.busy.filter((b) => b !== id) }));
      void get()
        .refresh({ background: true })
        .catch(() => {});
    }
  }

  return {
    ...EMPTY,

    refresh: async (options) => {
      const t = currentTransport();
      if (!t) {
        return;
      }
      // Best effort: without it the inbox still has its decisions.
      const recent = request(t, "proposals.list", { limit: 100 }).catch(
        () => null,
      );
      try {
        const { proposals } = await request(t, "proposals.list", {
          status: "pending",
        });
        const latest = await recent;
        set((s) => ({
          pending: proposals,
          recent: latest?.proposals ?? s.recent,
          load: { loaded: true, error: null },
        }));
      } catch (err) {
        if (!isQuietError(err, options?.background ?? false)) {
          set({ load: { loaded: true, error: describeError(err) } });
        }
        throw err;
      }
    },

    loadProposal: async (id) => {
      const t = currentTransport();
      if (!t) {
        return;
      }
      try {
        const { proposal } = await request(t, "proposals.get", {
          proposal_id: id,
        });
        set((s) => ({ detailById: { ...s.detailById, [id]: proposal } }));
      } catch (err) {
        // A dropped connection says nothing about whether it exists.
        if (isTransientError(err)) {
          return;
        }
        set((s) => ({
          detailById: {
            ...s.detailById,
            [id]: s.pending.find((p) => p.id === id) ?? null,
          },
        }));
      }
    },

    accept: async (id, note) => {
      const t = currentTransport();
      if (!t) {
        return null;
      }
      set((s) => {
        const { [id]: _cleared, ...requestErrors } = s.requestErrors;

        return { requesting: [...s.requesting, id], requestErrors };
      });
      const trimmed = note?.trim();
      try {
        const result = await request(t, "proposals.accept", {
          proposal_id: id,
          note: trimmed ? trimmed : undefined,
        });
        capture("web_proposal_handled", { action: "accept" });
        replace(result.proposal);

        return result.agent_id && result.session_id
          ? { agentId: result.agent_id, sessionId: result.session_id }
          : null;
      } catch (err) {
        // Shown on the card rather than the banner: it is about that one.
        set((s) => ({
          requestErrors: { ...s.requestErrors, [id]: describeError(err) },
        }));

        return null;
      } finally {
        set((s) => ({ requesting: s.requesting.filter((r) => r !== id) }));
        void get()
          .refresh({ background: true })
          .catch(() => {});
      }
    },

    dismiss: async (id, reason) => {
      const t = currentTransport();
      if (!t) {
        return false;
      }
      const ok = await decide(id, "Couldn't dismiss that proposal", async () => {
        const { proposal } = await request(t, "proposals.dismiss", {
          proposal_id: id,
          reason: reason?.trim() || undefined,
        });

        return proposal;
      });
      if (ok) {
        capture("web_proposal_handled", { action: "dismiss" });
      }

      return ok;
    },

    resolve: async (id, note) => {
      const t = currentTransport();
      if (!t) {
        return false;
      }
      const ok = await decide(
        id,
        "Couldn't mark that proposal done",
        async () => {
          const { proposal } = await request(t, "proposals.resolve", {
            proposal_id: id,
            note: note?.trim() || undefined,
          });

          return proposal;
        },
      );
      if (ok) {
        capture("web_proposal_handled", { action: "resolve" });
      }

      return ok;
    },

    requestRevision: async (id, note) => {
      const t = currentTransport();
      if (!t) {
        return null;
      }
      let started: boolean | null = null;
      const ok = await decide(id, "Couldn't ask for a revision", async () => {
        const result = await request(t, "proposals.request_revision", {
          proposal_id: id,
          note,
        });
        started = result.run_started;

        return result.proposal;
      });
      if (ok) {
        capture("web_proposal_handled", { action: "request_revision" });
      }

      return started;
    },

    performCleanup: async (id) => {
      const t = currentTransport();
      if (!t) {
        return false;
      }
      set((s) => ({ busy: [...s.busy, id], error: null }));
      try {
        await request(t, "proposals.perform_cleanup", { proposal_id: id });
        capture("web_proposal_handled", { action: "cleanup" });

        return true;
      } catch (err) {
        set({ error: `Couldn't run that cleanup — ${describeError(err)}` });

        return false;
      } finally {
        set((s) => ({ busy: s.busy.filter((b) => b !== id) }));
        void get()
          .refresh({ background: true })
          .catch(() => {});
      }
    },

    clearError: () => set({ error: null }),
  };
});

/** The inbox's input: pending first, then whatever else is recent. */
export function inboxProposals(
  pending: RemoteProposal[],
  recent: RemoteProposal[],
): RemoteProposal[] {
  const ids = new Set(pending.map((p) => p.id));

  return [
    ...pending,
    ...recent.filter((p) => !ids.has(p.id) && p.status !== "pending"),
  ];
}

export function resetProposals(): void {
  useProposalsStore.setState(EMPTY);
}
