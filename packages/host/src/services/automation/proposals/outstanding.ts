/**
 * What is still sitting in the inbox from earlier runs.
 *
 * Handed to every run of the same automation before it thinks, because the
 * failure it prevents is the obvious one: a daily triage proposing the same
 * issue every morning until someone finally answers. Knowing what is already
 * waiting is what lets a run supersede it or withdraw it instead.
 */

import type { Proposal } from "./models";
import { listProposals } from "./manager";

/** How many outstanding proposals a run is told about. Beyond this is noise. */
const MAX_LISTED = 20;

/** This automation's undecided proposals, newest first. */
export function outstandingProposals(automationId: string): Proposal[] {
  return listProposals({ automationId, status: "pending" }).slice(
    0,
    MAX_LISTED,
  );
}

/** "3 days" / "4 hours" / "just now" — enough to judge staleness. */
export function proposalAge(createdAt: number, now = Date.now()): string {
  const hours = Math.floor((now - createdAt) / 3_600_000);
  if (hours < 1) {
    return "just now";
  }
  if (hours < 48) {
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.floor(hours / 24);

  return `${days} days ago`;
}

/** One line per proposal: the id the tools take, and enough to recognise it. */
export function outstandingLine(proposal: Proposal, now = Date.now()): string {
  const parts = [proposalAge(proposal.created_at, now)];
  if (proposal.source_ref) {
    parts.push(proposal.source_ref.external_id);
  }

  return `- \`${proposal.id}\` — "${proposal.title}" (${parts.join(", ")})`;
}

/**
 * The prompt block, or null when the inbox is clear for this automation — a
 * heading over an empty list only invites the model to invent one.
 */
export function outstandingBlock(
  automationId: string,
  now = Date.now(),
): string | null {
  const pending = outstandingProposals(automationId);
  if (pending.length === 0) {
    return null;
  }

  return [
    "",
    "## Already in the inbox",
    "",
    `${pending.length} proposal(s) from earlier runs of this automation are still undecided:`,
    "",
    ...pending.map((p) => outstandingLine(p, now)),
    "",
    "Deal with each of them before you propose anything new:",
    "",
    '- Proposing the same work again? Emit the new one with `supersedes: ["<id>"]` so the old one leaves the inbox instead of being duplicated.',
    "- Signal gone — PR merged or closed, issue closed, branch deleted, the thing already done? Call `withdraw_proposal` with what you found.",
    "- Still valid and still worth a decision? Leave it alone and do not re-propose it.",
    "",
    "Use `list_open_proposals` if you need the full text of one.",
  ].join("\n");
}
