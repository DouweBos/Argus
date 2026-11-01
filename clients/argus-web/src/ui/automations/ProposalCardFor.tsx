/**
 * Peacock's `ProposalCard`, wired to the gateway: start (with or without a
 * note), ask for a revision, mark done, dismiss, or follow the CTA. A
 * computer this browser only monitors shows the card read-only.
 */

import type { RemoteProposal } from "@argus/remote-protocol";
import {
  decidedNote,
  proposalPrimary,
  proposalStartState,
} from "@argus/client-core";
import { Badge, ProposalCard, type ProposalCardAction } from "@argus/peacock";
import { openAgent } from "../../routing/open";
import { appNavigate } from "../../routing/router";
import { useConnectionStore } from "../../stores/connection";
import { useProposalsStore } from "../../stores/proposals";
import { capture } from "../../telemetry/telemetry";

function openExternal(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

export function ProposalCardFor({
  afterDecide,
  proposal,
  showDecided = false,
}: {
  /** Where to go once a dismissal or "done" lands (the proposal's own page leaves). */
  afterDecide?: () => void;
  proposal: RemoteProposal;
  /** Read what happened to a decided one, rather than hiding it. */
  showDecided?: boolean;
}) {
  const hasControl = useConnectionStore((s) => s.hasControl());
  const busy = useProposalsStore((s) => s.busy.includes(proposal.id));
  const requesting = useProposalsStore((s) =>
    s.requesting.includes(proposal.id),
  );
  const refusal = useProposalsStore((s) => s.requestErrors[proposal.id]);
  const store = useProposalsStore.getState;

  const pending = proposal.status === "pending";
  const decided = showDecided
    ? decidedNote(proposal, proposal.automation_name)
    : null;
  const readOnly = !hasControl && pending;
  const { error, progress } = proposalStartState(proposal, {
    refusal,
    requesting,
  });

  const start = async (note?: string) => {
    const started = await store().accept(proposal.id, note);
    if (started) {
      openAgent({ agent_id: started.agentId, session_id: started.sessionId });
    }
  };

  const primarySpec = proposalPrimary(
    proposal.cta,
    Boolean(proposal.start_error ?? refusal),
  );
  let primary: ProposalCardAction | undefined;
  if (primarySpec?.kind === "start") {
    primary = {
      kind: "start",
      label: primarySpec.label,
      onClick: () => void start(),
    };
  } else if (primarySpec?.kind === "destroy") {
    primary = {
      kind: "destroy",
      label: primarySpec.label,
      confirm: primarySpec.confirm,
      onClick: () => void store().performCleanup(proposal.id),
    };
  } else if (primarySpec?.kind === "open") {
    const url = primarySpec.url;
    primary = {
      kind: "open",
      label: primarySpec.label,
      onClick: () => openExternal(url),
    };
  }
  const canAct = hasControl && pending && !decided;

  return (
    <ProposalCard
      busy={busy}
      confidence={proposal.confidence}
      decided={
        decided ??
        (readOnly
          ? "Deciding needs control of this computer. Pair with control to start or dismiss it."
          : undefined)
      }
      error={error}
      meta={
        <>
          {proposal.project && <Badge tone="neutral">{proposal.project}</Badge>}
          <Badge tone="neutral">{proposal.automation_name}</Badge>
        </>
      }
      primary={canAct ? primary : undefined}
      progress={progress}
      rationale={proposal.rationale || undefined}
      revisionRequest={proposal.revision_request || undefined}
      sourceLabel={proposal.source_label ?? undefined}
      summary={proposal.summary}
      title={proposal.title}
      onDismiss={(reason) => {
        void store()
          .dismiss(proposal.id, reason)
          .then((ok) => ok && afterDecide?.());
      }}
      onOpenRun={
        proposal.run_id
          ? () => {
              capture("web_proposal_opened");
              appNavigate({
                name: "automationRun",
                automationId: proposal.automation_id,
                runId: proposal.run_id as string,
              });
            }
          : undefined
      }
      onOpenSource={
        proposal.source_url
          ? () => openExternal(proposal.source_url as string)
          : undefined
      }
      onRequestRevision={
        canAct
          ? (note) => void store().requestRevision(proposal.id, note)
          : undefined
      }
      onResolve={
        canAct
          ? (note) => {
              void store()
                .resolve(proposal.id, note)
                .then((ok) => ok && afterDecide?.());
            }
          : undefined
      }
      onStartWithNote={
        canAct && proposal.cta?.kind === "start_session"
          ? (note) => void start(note)
          : undefined
      }
    />
  );
}
