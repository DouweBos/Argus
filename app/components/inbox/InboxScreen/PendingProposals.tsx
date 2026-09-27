import type { Proposal } from "../../../lib/types";
import { Badge, ProposalCard } from "@argus/peacock";
import { openExternalUrl } from "../../../lib/ipc";
import {
  PROPOSAL_ACTION_LABELS,
  PROPOSAL_ACTION_TONES,
  proposalProjectName,
} from "../../../lib/proposals";
import { openRunFor, useAutomations } from "../../../stores/automationStore";
import { renderProposalMarkdown } from "../proposalMarkdown";
import { useProposalActions } from "../useProposalActions";
import styles from "./InboxScreen.module.css";

export function PendingProposals({ proposals }: { proposals: Proposal[] }) {
  const automations = useAutomations();
  const {
    busyId,
    dismiss,
    primaryAction,
    requestRevision,
    resolve,
    startWithNote,
  } = useProposalActions();

  return (
    <div className={styles.cards}>
      {proposals.map((proposal) => {
        const project = proposalProjectName(proposal.repo_root);
        const automation = automations.find(
          (a) => a.id === proposal.automation_id,
        );
        const source = proposal.source_ref;

        return (
          <ProposalCard
            busy={busyId === proposal.id}
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
                {automation && <Badge tone="neutral">{automation.name}</Badge>}
              </>
            }
            onDismiss={(reason) => dismiss(proposal, reason)}
            onOpenRun={() =>
              openRunFor(proposal.automation_id, proposal.run_id)
            }
            onOpenSource={
              source
                ? () => {
                    // Client-side by design: the issue opens in *your*
                    // browser even when the proposal came from another host.
                    openExternalUrl(source.url).catch(() => undefined);
                  }
                : undefined
            }
            onRequestRevision={requestRevision(proposal)}
            onResolve={resolve(proposal)}
            onStartWithNote={startWithNote(proposal)}
            primary={primaryAction(proposal)}
            rationale={proposal.rationale || undefined}
            renderMarkdown={renderProposalMarkdown}
            revisionRequest={proposal.revision_request || undefined}
            sourceLabel={source?.external_id}
            summary={proposal.summary}
            title={proposal.title}
          />
        );
      })}
    </div>
  );
}
