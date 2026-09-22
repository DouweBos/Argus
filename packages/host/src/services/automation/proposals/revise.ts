/**
 * Asking for a better proposal.
 *
 * The third answer to a proposal, next to starting it and dismissing it: it is
 * close, but not close enough to hand an agent. The note is kept on the
 * proposal — which stays pending — and the automation is run again so it can
 * supersede it with one that takes the note into account. The run is a
 * courtesy: if one is already in flight or the day's budget is spent, the note
 * still waits on the proposal and the next scheduled run reads it.
 */

import type { Proposal } from "./models";
import { info } from "@argus/host/logger";
import { requireProposal, updateProposal } from "./manager";

export interface RequestRevisionResult {
  proposal: Proposal;
  /** False when no run was started — the note waits for the next one. */
  run_started: boolean;
}

export async function requestProposalRevision(
  proposalId: string,
  note: string,
): Promise<RequestRevisionResult> {
  const trimmed = note.trim();
  if (!trimmed) {
    throw "Say what should change — a revision with no note is a re-run.";
  }
  const existing = requireProposal(proposalId);
  if (existing.status !== "pending") {
    throw `Proposal ${proposalId} is ${existing.status}, not pending`;
  }

  const proposal = updateProposal(proposalId, {
    revision_request: trimmed,
    revision_requested_at: Date.now(),
  });

  // Lazy: the runner reaches back into proposals for its prompt, so importing
  // it at module scope would close the cycle.
  const { startAutomationRun } = await import("../runner");
  const run = startAutomationRun(
    proposal.automation_id,
    `Revision requested on "${proposal.title}"`,
  );
  info(`Proposal ${proposal.id} revision requested (run ${run.status})`);

  return { proposal, run_started: run.status === "running" };
}
