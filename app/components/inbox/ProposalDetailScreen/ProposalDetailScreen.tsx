/**
 * `/inbox/proposals/:proposalId` — one proposal, in full.
 *
 * Home and the inbox both show proposals, but only in summary; this is where
 * the whole of one is readable and where it gets decided. Deciding ends the
 * proposal, so both outcomes leave: a start follows the session it created, a
 * dismissal goes back to the inbox.
 */

import { Badge, Button, EmptyState, Icons, ProposalCard } from "@argus/peacock";
import { openExternalUrl } from "../../../lib/ipc";
import {
  PROPOSAL_ACTION_LABELS,
  PROPOSAL_ACTION_TONES,
  proposalProjectName,
} from "../../../lib/proposals";
import { useRouteProposalId } from "../../../lib/routeHooks";
import {
  openAutomation,
  openAutomationRun,
  useAutomations,
} from "../../../stores/automationStore";
import { openInbox, useProposal } from "../../../stores/proposalStore";
import { selectSession } from "../../../stores/sessionStore";
import { useProposalActions } from "../useProposalActions";
import styles from "./ProposalDetailScreen.module.css";

export function ProposalDetailScreen() {
  const proposalId = useRouteProposalId();
  const proposal = useProposal(proposalId);
  const automations = useAutomations();
  const { busyId, dismiss, primaryAction } = useProposalActions();

  if (!proposal) {
    return (
      <div className={styles.screen}>
        <EmptyState
          action={
            <Button onClick={() => openInbox()} size="sm">
              Back to the inbox
            </Button>
          }
          body="It was decided on, or the host that raised it is no longer attached."
          icon={<Icons.EnvelopeIcon size={18} />}
          title="This proposal is gone"
        />
      </div>
    );
  }

  const automation = automations.find((a) => a.id === proposal.automation_id);
  const project = proposalProjectName(proposal.repo_root);
  const source = proposal.source_ref;

  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <Button
          leading={<Icons.ChevronLeftIcon size={10} />}
          onClick={() => openInbox()}
          size="sm"
          variant="ghost"
        >
          Inbox
        </Button>
      </header>

      <ProposalCard
        busy={busyId === proposal.id}
        confidence={proposal.confidence}
        meta={
          <>
            <Badge tone={PROPOSAL_ACTION_TONES[proposal.recommended_action]}>
              {PROPOSAL_ACTION_LABELS[proposal.recommended_action]}
            </Badge>
            {project && <Badge tone="neutral">{project}</Badge>}
            {automation && <Badge tone="neutral">{automation.name}</Badge>}
          </>
        }
        onDismiss={(reason) => {
          dismiss(proposal, reason);
          openInbox();
        }}
        onOpenSource={
          source
            ? () => {
                // Client-side by design: the issue opens in *your* browser
                // even when the proposal came from another host.
                openExternalUrl(source.url).catch(() => undefined);
              }
            : undefined
        }
        primary={primaryAction(proposal)}
        rationale={proposal.rationale || undefined}
        sourceLabel={source?.external_id}
        summary={proposal.summary}
        title={proposal.title}
      />

      <div className={styles.provenance}>
        <span className={styles.label}>Came from</span>
        <Button
          onClick={() =>
            openAutomationRun(proposal.automation_id, proposal.run_id)
          }
          size="sm"
          variant="ghost"
        >
          {automation
            ? `${automation.name} — this run`
            : "The run that raised it"}
        </Button>
        {automation && (
          <Button
            onClick={() => openAutomation(automation.id)}
            size="sm"
            variant="ghost"
          >
            The automation
          </Button>
        )}
        {proposal.session_id && (
          <Button
            onClick={() => selectSession(proposal.session_id as string)}
            size="sm"
            variant="ghost"
          >
            The session it started
          </Button>
        )}
      </div>
    </div>
  );
}
