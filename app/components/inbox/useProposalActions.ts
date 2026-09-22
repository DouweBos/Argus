/**
 * Everything you can do with a proposal — start it (with or without a note),
 * ask the automation for a better one, mark it done, dismiss it, follow its
 * CTA — shared by the inbox list and the proposal's own page so both behave
 * identically and stay busy on the same card.
 */

import type { Proposal } from "../../lib/types";
import type { ProposalCardAction } from "@argus/peacock";
import { useState } from "react";
import { openExternalUrl, performProposalCleanup } from "../../lib/ipc";
import {
  acceptProposal,
  dismissProposal,
  requestProposalRevision,
  resolveProposal,
} from "../../stores/proposalStore";
import { selectSession } from "../../stores/sessionStore";

export interface ProposalActions {
  busyId: string | null;
  dismiss: (proposal: Proposal, reason: string) => void;
  /** The CTA the run wrote, or nothing when there is nothing to start. */
  primaryAction: (proposal: Proposal) => ProposalCardAction | undefined;
  /** Ask the automation to redo it. Undefined when it cannot be redone. */
  requestRevision: (proposal: Proposal) => ((note: string) => void) | undefined;
  /** Mark it done by hand. Undefined once it has already been decided. */
  resolve: (proposal: Proposal) => ((note: string) => void) | undefined;
  /** Start it with a note. Undefined when the proposal starts nothing. */
  startWithNote: (proposal: Proposal) => ((note: string) => void) | undefined;
}

export function useProposalActions(): ProposalActions {
  const [busyId, setBusyId] = useState<string | null>(null);

  const start = async (proposal: Proposal, note?: string) => {
    setBusyId(proposal.id);
    try {
      // The backend creates the session and spawns the agent; all that is
      // left is to take the user to the work it just started.
      const result = await acceptProposal(proposal.id, note);
      selectSession(result.session_id);
    } catch {
      // The list refreshes from `proposals:changed`; a failed accept leaves
      // the card exactly where it was.
    } finally {
      setBusyId(null);
    }
  };

  // Deleting is the backend's to do and the inbox's to reflect: the card goes
  // when `proposals:changed` says it went, not when the button was pressed.
  const cleanup = (proposal: Proposal) => {
    setBusyId(proposal.id);
    performProposalCleanup(proposal.id)
      .catch(() => undefined)
      .finally(() => setBusyId(null));
  };

  const dismiss = (proposal: Proposal, reason: string) => {
    setBusyId(proposal.id);
    dismissProposal(proposal.id, reason || undefined)
      // Same as above — the card stays until the host says otherwise.
      .catch(() => undefined)
      .finally(() => setBusyId(null));
  };

  // The proposal stays put: the automation answers it on its next run, by
  // superseding it or withdrawing it, and the inbox follows that.
  const requestRevision = (proposal: Proposal) =>
    proposal.status === "pending"
      ? (note: string) => {
          setBusyId(proposal.id);
          requestProposalRevision(proposal.id, note)
            .catch(() => undefined)
            .finally(() => setBusyId(null));
        }
      : undefined;

  // You did it yourself: the proposal was right, so this is not a dismissal
  // and must not be recorded as one.
  const resolve = (proposal: Proposal) =>
    proposal.status === "pending"
      ? (note: string) => {
          setBusyId(proposal.id);
          resolveProposal(proposal.id, note || undefined)
            .catch(() => undefined)
            .finally(() => setBusyId(null));
        }
      : undefined;

  const startWithNote = (proposal: Proposal) =>
    proposal.cta?.kind === "start_session" && proposal.status === "pending"
      ? (note: string) => {
          start(proposal, note).catch(() => undefined);
        }
      : undefined;

  const primaryAction = (
    proposal: Proposal,
  ): ProposalCardAction | undefined => {
    const cta = proposal.cta;
    if (!cta) {
      return undefined;
    }
    if (cta.kind === "start_session") {
      return {
        kind: "start",
        label: cta.label,
        onClick: () => {
          start(proposal).catch(() => undefined);
        },
      };
    }
    if (cta.kind === "delete_branch" || cta.kind === "delete_session") {
      return {
        kind: "destroy",
        label: cta.label,
        confirm:
          cta.kind === "delete_branch"
            ? `${cta.force ? "git branch -D" : "git branch -d"} ${cta.branch ?? ""} — commits only on this branch are gone for good.`
            : "The worktree and anything uncommitted in it are deleted. The branch is left alone.",
        onClick: () => cleanup(proposal),
      };
    }
    const url = cta.url;

    return url
      ? {
          kind: "open",
          label: cta.label,
          // Client-side by design, same as the source link on the card.
          onClick: () => {
            openExternalUrl(url).catch(() => undefined);
          },
        }
      : undefined;
  };

  return {
    busyId,
    dismiss,
    primaryAction,
    requestRevision,
    resolve,
    startWithNote,
  };
}
