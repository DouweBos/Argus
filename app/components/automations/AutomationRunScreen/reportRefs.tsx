import { useCallback } from "react";
import { Badge, ConfidenceMeter, type ReportRef } from "@argus/peacock";
import {
  PROPOSAL_ACTION_LABELS,
  PROPOSAL_ACTION_TONES,
  proposalProjectName,
} from "../../../lib/proposals";
import { sessionStatusLabel } from "../../../lib/types";
import { openProposal, useProposals } from "../../../stores/proposalStore";
import { selectSession, useSessions } from "../../../stores/sessionStore";

/**
 * Resolves the ids a report points at against current state, so `proposals`
 * and `sessions` blocks render live cards rather than a snapshot that rots.
 */
export function useReportRefResolvers(): {
  resolveProposal: (id: string) => ReportRef | null;
  resolveSession: (id: string) => ReportRef | null;
} {
  const sessions = useSessions();
  const proposals = useProposals();

  const resolveSession = useCallback(
    (id: string): ReportRef | null => {
      const session = sessions.find((s) => s.id === id);
      if (!session) {
        return null;
      }
      const project = session.repo_root.split("/").filter(Boolean).pop() ?? "";

      return {
        id,
        title: session.display_name ?? session.branch,
        subtitle: project,
        meta: (
          <Badge tone="neutral">{sessionStatusLabel(session.status)}</Badge>
        ),
        onOpen: () => selectSession(id),
      };
    },
    [sessions],
  );

  // Resolved against the live list, never the report's snapshot: a proposal
  // decided on since the run wrote about it renders as a tombstone.
  const resolveProposal = useCallback(
    (id: string): ReportRef | null => {
      const proposal = proposals.find((p) => p.id === id);
      if (!proposal) {
        return null;
      }

      return {
        id,
        title: proposal.title,
        subtitle: proposalProjectName(proposal.repo_root) ?? undefined,
        meta: (
          <>
            <Badge tone={PROPOSAL_ACTION_TONES[proposal.recommended_action]}>
              {PROPOSAL_ACTION_LABELS[proposal.recommended_action]}
            </Badge>
            <ConfidenceMeter compact value={proposal.confidence} />
          </>
        ),
        onOpen: () => openProposal(id),
      };
    },
    [proposals],
  );

  return { resolveProposal, resolveSession };
}
