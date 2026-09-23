/**
 * Carrying out a cleanup a proposal argued for.
 *
 * The inbox's other button starts work; this one destroys some. So the rule
 * here is that the run never gets to do it — a proposal only ever describes
 * the deletion, and this runs when a human presses the button. The proposal is
 * marked accepted afterwards, which is what takes it out of the inbox.
 */

import type { Proposal } from "./models";
import { info } from "@argus/host/logger";
import { appState } from "../../../state";
import { gitDeleteBranch } from "../../session/gitBranchOps";
import { deleteSession } from "../../session/manager";
import { assertVolumeConnected } from "../../session/volumeAvailability";
import { requireProposal, updateProposal } from "./manager";

/**
 * Branch ops act through a session, and only the project root may touch a
 * branch nobody checked out — which is exactly what a loose branch is.
 */
function projectRootSessionId(repoRoot: string): string {
  for (const session of appState.sessions.values()) {
    if (session.kind === "project_root" && session.repo_root === repoRoot) {
      return session.id;
    }
  }

  throw `${repoRoot} is not open in Argus, so its branches cannot be touched`;
}

/** Run the proposal's cleanup CTA. Throws a string, as every IPC handler does. */
export async function performProposalCleanup(
  proposalId: string,
): Promise<Proposal> {
  const proposal = requireProposal(proposalId);
  const cta = proposal.cta;
  if (!cta) {
    throw "This proposal asks for nothing.";
  }
  if (proposal.status !== "pending") {
    throw `This proposal is already ${proposal.status}.`;
  }

  if (cta.kind === "delete_branch") {
    if (!cta.branch || !proposal.repo_root) {
      throw "The proposal does not say which branch to delete.";
    }
    assertVolumeConnected(proposal.repo_root);
    await gitDeleteBranch(projectRootSessionId(proposal.repo_root), {
      name: cta.branch,
      force: cta.force,
    });
    info(`Proposal ${proposal.id}: deleted branch ${cta.branch}`);
  } else if (cta.kind === "delete_session") {
    if (!cta.session_id) {
      throw "The proposal does not say which session to retire.";
    }
    // Deleting a worktree that is merely unreachable leaves git's registration
    // behind, which breaks every later git call in the repo. One that is
    // genuinely gone is exactly what this button is for.
    const target = appState.sessions.get(cta.session_id);
    if (target) {
      assertVolumeConnected(target.path);
    }
    // Never the branch as well: a branch worth deleting is its own proposal,
    // with its own evidence and its own button.
    await deleteSession(cta.session_id, false);
    info(`Proposal ${proposal.id}: deleted session ${cta.session_id}`);
  } else {
    throw `A ${cta.kind} proposal is not a cleanup.`;
  }

  return updateProposal(proposal.id, { status: "accepted" });
}
