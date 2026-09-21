/**
 * Proposals as one-glance cards, for home. Deciding needs the rationale and
 * the full summary, so the card opens the proposal's page rather than
 * carrying the decision itself.
 */

import type { Proposal } from "../../lib/types";
import { Badge, ProposalSummaryCard } from "@argus/peacock";
import {
  PROPOSAL_ACTION_LABELS,
  PROPOSAL_ACTION_TONES,
  proposalProjectName,
} from "../../lib/proposals";
import { openProposal } from "../../stores/proposalStore";
import styles from "./InboxScreen/InboxScreen.module.css";

export function ProposalSummaries({ proposals }: { proposals: Proposal[] }) {
  return (
    <div className={styles.cards}>
      {proposals.map((proposal) => {
        const project = proposalProjectName(proposal.repo_root);

        return (
          <ProposalSummaryCard
            confidence={proposal.confidence}
            key={proposal.id}
            meta={
              <>
                <Badge
                  tone={PROPOSAL_ACTION_TONES[proposal.recommended_action]}
                >
                  {PROPOSAL_ACTION_LABELS[proposal.recommended_action]}
                </Badge>
                {project && <Badge tone="neutral">{project}</Badge>}
              </>
            }
            onOpen={() => openProposal(proposal.id)}
            summary={proposal.summary}
            title={proposal.title}
          />
        );
      })}
    </div>
  );
}
