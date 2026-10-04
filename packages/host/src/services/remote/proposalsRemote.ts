/**
 * The inbox, narrowed for a phone.
 *
 * Same bargain as `automationsRemote.ts`: the wire shape carries what you need
 * to decide — what it is, why, how sure the run was, and the one button it is
 * asking for — and nothing you would only use to edit it. Names are resolved
 * here because a phone has no automations file to join against and no business
 * knowing a path on someone else's disk.
 *
 * Deciding is `control`; reading is `monitor`; a huddle guest gets neither
 * (see `METHOD_SCOPE`).
 */

import type { Proposal } from "../automation/proposals/models";
import type {
  RemoteProposal,
  RemoteProposalStatus,
} from "@argus/remote-protocol";
import path from "node:path";
import { getAutomation } from "../automation/manager";
import {
  dismissProposal,
  getProposal,
  listProposals,
  requireProposal,
  resolveProposal,
} from "../automation/proposals/manager";

/** How many a client gets when it doesn't say. */
const DEFAULT_LIMIT = 50;

export function toRemoteProposal(proposal: Proposal): RemoteProposal {
  const source = proposal.source_ref;

  return {
    id: proposal.id,
    automation_id: proposal.automation_id,
    run_id: proposal.run_id,
    automation_name:
      getAutomation(proposal.automation_id)?.name ?? "Automation",
    title: proposal.title,
    summary: proposal.summary,
    rationale: proposal.rationale,
    confidence: proposal.confidence,
    cta: proposal.cta,
    status: proposal.status,
    project: proposal.repo_root ? path.basename(proposal.repo_root) : null,
    source_label: source?.external_id ?? null,
    source_url: source?.url ?? null,
    session_id: proposal.session_id,
    agent_id: proposal.agent_id,
    start_stage: proposal.start_stage,
    start_error: proposal.start_error,
    created_at: proposal.created_at,
    accepted_note: proposal.accepted_note,
    dismissed_reason: proposal.dismissed_reason,
    resolved_note: proposal.resolved_note,
    revision_request: proposal.revision_request,
    cleared_reason: proposal.cleared_reason,
    superseded_by: proposal.superseded_by,
  };
}

/** One proposal in full, or null when the host doesn't know it. */
export function remoteProposal(
  proposalId: string,
): { proposal: RemoteProposal } | null {
  const proposal = getProposal(proposalId);

  return proposal ? { proposal: toRemoteProposal(proposal) } : null;
}

/** Ask the automation for a better one — the same call the desktop makes. */
export async function requestRemoteProposalRevision(
  proposalId: string,
  note: string,
): Promise<{ proposal: RemoteProposal; run_started: boolean }> {
  // Loaded on use: a revision starts a run, which reaches the agent stack.
  const { requestProposalRevision } =
    await import("../automation/proposals/revise");
  const result = await requestProposalRevision(proposalId, note);

  return {
    proposal: toRemoteProposal(result.proposal),
    run_started: result.run_started,
  };
}

export function remoteProposals(params: {
  limit?: number;
  status?: RemoteProposalStatus;
}): { proposals: RemoteProposal[] } {
  const proposals = listProposals({ status: params.status })
    .slice(0, params.limit ?? DEFAULT_LIMIT)
    .map(toRemoteProposal);

  return { proposals };
}

/** Long enough for a refusal to come back as the answer, short of any timeout. */
const ACCEPT_ANSWER_WINDOW_MS = 1500;

/**
 * Start the work. The heavy lifting — worktree, setup, agent, brief — is the
 * same call the desktop inbox makes, so a proposal accepted from a phone is
 * indistinguishable from one accepted at the machine. Building the session can
 * take minutes, so this answers once it is under way and the phone follows the
 * proposal's `start_stage` from there.
 */
export async function acceptRemoteProposal(
  proposalId: string,
  note?: string,
): Promise<{
  agent_id: string | null;
  proposal: RemoteProposal;
  session_id: string | null;
}> {
  // Loaded on use: accepting reaches the agent stack, which reaches back to
  // this gateway for push, and a static import would close that ring.
  const { acceptProposal } = await import("../automation/proposals/accept");
  const started = acceptProposal(proposalId, { note });
  // A failure after the window is recorded on the proposal as `start_error`.
  started.catch(() => undefined);

  const early = await Promise.race([
    started,
    new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), ACCEPT_ANSWER_WINDOW_MS),
    ),
  ]);
  if (early) {
    return {
      proposal: toRemoteProposal(early.proposal),
      session_id: early.session_id,
      agent_id: early.agent_id,
    };
  }

  return {
    proposal: toRemoteProposal(requireProposal(proposalId)),
    session_id: null,
    agent_id: null,
  };
}

/**
 * Press a cleanup proposal's button from the phone. The deletion itself is the
 * same call the desktop inbox makes — a branch cleared from a sofa is cleared.
 */
export async function performRemoteProposalCleanup(
  proposalId: string,
): Promise<{ proposal: RemoteProposal }> {
  // Loaded on use, like accepting: the cleanup reaches the session stack,
  // which reaches back to this gateway.
  const { performProposalCleanup } =
    await import("../automation/proposals/cleanup");

  return {
    proposal: toRemoteProposal(await performProposalCleanup(proposalId)),
  };
}

/**
 * Mark it done from the phone — the user already did what it asked. Null when
 * the proposal is unknown.
 */
export function resolveRemoteProposal(
  proposalId: string,
  note?: string,
): { proposal: RemoteProposal } | null {
  if (!getProposal(proposalId)) {
    return null;
  }

  return { proposal: toRemoteProposal(resolveProposal(proposalId, note)) };
}

/** Dismiss it, with the reason verbatim. Null when the proposal is unknown. */
export function dismissRemoteProposal(
  proposalId: string,
  reason?: string,
): { proposal: RemoteProposal } | null {
  if (!getProposal(proposalId)) {
    return null;
  }

  return { proposal: toRemoteProposal(dismissProposal(proposalId, reason)) };
}
