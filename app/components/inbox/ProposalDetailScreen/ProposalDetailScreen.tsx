/**
 * `/inbox/proposals/:proposalId` — one proposal, in full.
 *
 * Home and the inbox both show proposals, but only in summary; this is where
 * the whole of one is readable and where it gets decided. Deciding ends the
 * proposal, so every outcome leaves: a start follows the session it created,
 * a dismissal or a "done" goes back to the inbox. One that is already decided — or that a
 * later run cleared — still reads here, with its buttons gone.
 */

import type { Proposal } from "../../../lib/types";
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

/**
 * What happened to a proposal nobody can act on any more, or null while it is
 * still waiting. A withdrawal names the automation: it was Argus's call, not
 * yours, and the reason is the evidence it had.
 */
function decidedNote(
  proposal: Proposal,
  automationName: string | undefined,
): string | null {
  const by = automationName ?? "the automation";
  switch (proposal.status) {
    case "pending":
      return null;
    case "accepted":
      return "You started this. It is in the session below.";
    case "auto_started":
      return "Argus started this itself — the guardrails allowed it.";
    case "dismissed":
      return proposal.dismissed_reason
        ? `You dismissed this: ${proposal.dismissed_reason}`
        : "You dismissed this.";
    case "resolved":
      return proposal.resolved_note
        ? `You marked this done: ${proposal.resolved_note}`
        : "You marked this done — you handled it yourself.";
    case "superseded":
      return `A later run of ${by} proposed the same work again${proposal.cleared_reason ? `: ${proposal.cleared_reason}` : "."}`;
    case "withdrawn":
      return `${by} withdrew this${proposal.cleared_reason ? `: ${proposal.cleared_reason}` : " — the signal behind it went away."}`;
  }
}

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
  const decided = decidedNote(proposal, automation?.name);
  const markDone = resolve(proposal);
  const { error, progress } = startState(proposal);

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
        decided={decided}
        error={error}
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

      <div className={styles.provenance}>
        <span className={styles.label}>Came from</span>
        <Button
          onClick={() => openRunFor(proposal.automation_id, proposal.run_id)}
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
        {proposal.superseded_by && (
          <Button
            onClick={() => openProposal(proposal.superseded_by as string)}
            size="sm"
            variant="ghost"
          >
            The proposal that replaced it
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
