/**
 * `/inbox/proposals/:proposalId` — one proposal, in full.
 *
 * Home and the inbox both show proposals, but only in summary; this is where
 * the whole of one is readable and where it gets decided. Deciding ends the
 * proposal, so every outcome leaves: a start follows the session it created,
 * a dismissal or a "done" goes back to the inbox. One that is already decided — or that a
 * later run cleared — still reads here, with its buttons gone.
 */

import { decidedNote } from "@argus/client-core";
import { Badge, ProposalCard, ProposalDetailView } from "@argus/peacock";
import { openExternalUrl } from "../../../lib/ipc";
import {
  PROPOSAL_ACTION_LABELS,
  PROPOSAL_ACTION_TONES,
  proposalProjectName,
} from "../../../lib/proposals";
import { useRouteProposalId } from "../../../lib/routeHooks";
import {
  openAutomation,
  openRunFor,
  useAutomations,
} from "../../../stores/automationStore";
import {
  openInbox,
  openProposal,
  useProposal,
} from "../../../stores/proposalStore";
import { selectSession } from "../../../stores/sessionStore";
import { renderProposalMarkdown } from "../proposalMarkdown";
import { useProposalActions } from "../useProposalActions";
import styles from "./ProposalDetailScreen.module.css";

export function ProposalDetailScreen() {
  const proposalId = useRouteProposalId();
  const proposal = useProposal(proposalId);
  const automations = useAutomations();
  const {
    busyId,
    dismiss,
    primaryAction,
    requestRevision,
    resolve,
    startState,
    startWithNote,
  } = useProposalActions();

  if (!proposal) {
    return (
      <div className={styles.screen}>
        <ProposalDetailView card={null} links={[]} onBack={() => openInbox()} />
      </div>
    );
  }

  const automation = automations.find((a) => a.id === proposal.automation_id);
  const project = proposalProjectName(proposal.repo_root);
  const source = proposal.source_ref;
  const decided = decidedNote(proposal, automation?.name);
  const markDone = resolve(proposal);
  const { error, progress } = startState(proposal);

  const links = [
    {
      label: automation
        ? `${automation.name} — this run`
        : "The run that raised it",
      onClick: () => openRunFor(proposal.automation_id, proposal.run_id),
    },
    ...(automation
      ? [
          {
            label: "The automation",
            onClick: () => openAutomation(automation.id),
          },
        ]
      : []),
    ...(proposal.superseded_by
      ? [
          {
            label: "The proposal that replaced it",
            onClick: () => openProposal(proposal.superseded_by as string),
          },
        ]
      : []),
    ...(proposal.session_id
      ? [
          {
            label: "The session it started",
            onClick: () => selectSession(proposal.session_id as string),
          },
        ]
      : []),
  ];

  return (
    <div className={styles.screen}>
      <ProposalDetailView
        card={
          <ProposalCard
            busy={busyId === proposal.id}
            confidence={proposal.confidence}
            decided={decided}
            error={error}
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
            onRequestRevision={requestRevision(proposal)}
            onResolve={
              markDone &&
              ((note) => {
                markDone(note);
                openInbox();
              })
            }
            onStartWithNote={startWithNote(proposal)}
            primary={decided ? undefined : primaryAction(proposal)}
            progress={progress}
            rationale={proposal.rationale || undefined}
            renderMarkdown={renderProposalMarkdown}
            revisionRequest={proposal.revision_request || undefined}
            sourceLabel={source?.external_id}
            summary={proposal.summary}
            title={proposal.title}
          />
        }
        links={links}
        onBack={() => openInbox()}
      />
    </div>
  );
}
