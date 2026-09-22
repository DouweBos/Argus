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
} from "../automation/proposals/manager";

/** How many a client gets when it doesn't say. */
const DEFAULT_LIMIT = 50;

export function toRemoteProposal(proposal: Proposal): RemoteProposal {
  const source = proposal.source_ref;

  return {
    id: proposal.id,
    automation_id: proposal.automation_id,
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
    created_at: proposal.created_at,
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

/**
 * Start the work. The heavy lifting — worktree, setup, agent, brief — is the
 * same call the desktop inbox makes, so a proposal accepted from a phone is
 * indistinguishable from one accepted at the machine.
 */
export async function acceptRemoteProposal(proposalId: string): Promise<{
  agent_id: string;
  proposal: RemoteProposal;
  session_id: string;
}> {
  // Loaded on use: accepting reaches the agent stack, which reaches back to
  // this gateway for push, and a static import would close that ring.
  const { acceptProposal } = await import("../automation/proposals/accept");
  const result = await acceptProposal(proposalId);

  return {
    proposal: toRemoteProposal(result.proposal),
    session_id: result.session_id,
    agent_id: result.agent_id,
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
