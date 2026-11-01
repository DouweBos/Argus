/**
 * How a proposal is labelled wherever it shows up — the inbox, home, and its
 * own page all have to agree about what a recommended action is called.
 */

import type { ProposalAction } from "./types";
import type { BadgeTone } from "@argus/peacock";

export { PROPOSAL_START_STAGE_LABELS } from "@argus/client-core";

export const PROPOSAL_ACTION_LABELS: Record<ProposalAction, string> = {
  ignore: "suggests ignoring",
  needs_info: "needs info",
  review: "worth a review",
  start_session: "ready to start",
};

export const PROPOSAL_ACTION_TONES: Record<ProposalAction, BadgeTone> = {
  ignore: "neutral",
  needs_info: "warning",
  review: "accent",
  start_session: "success",
};

/** The project a proposal would land in, as the sidebar names it. */
export function proposalProjectName(repoRoot: string | null): string | null {
  return repoRoot ? (repoRoot.split("/").filter(Boolean).pop() ?? null) : null;
}
