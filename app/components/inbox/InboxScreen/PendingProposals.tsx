import type { Proposal, ProposalAction } from "../../../lib/types";
import type { BadgeTone } from "@argus/peacock";
import { useState } from "react";
import { Badge, ProposalCard } from "@argus/peacock";
import { openExternalUrl } from "../../../lib/ipc";
import { useAutomations } from "../../../stores/automationStore";
import { acceptProposal, dismissProposal } from "../../../stores/proposalStore";
import { selectSession } from "../../../stores/sessionStore";
import styles from "./InboxScreen.module.css";

const ACTION_LABELS: Record<ProposalAction, string> = {
  ignore: "suggests ignoring",
  needs_info: "needs info",
  review: "worth a review",
  start_session: "ready to start",
};

const ACTION_TONES: Record<ProposalAction, BadgeTone> = {
  ignore: "neutral",
  needs_info: "warning",
  review: "accent",
  start_session: "success",
};

function projectName(repoRoot: string | null): string | null {
  return repoRoot ? (repoRoot.split("/").filter(Boolean).pop() ?? null) : null;
}

export function PendingProposals({ proposals }: { proposals: Proposal[] }) {
  const automations = useAutomations();
  const [busyId, setBusyId] = useState<string | null>(null);

  const start = async (proposal: Proposal) => {
    setBusyId(proposal.id);
    try {
      // The backend creates the session and spawns the agent; all that is
      // left is to take the user to the work it just started.
      const result = await acceptProposal(proposal.id);
      selectSession(result.session_id);
    } catch {
      // The list refreshes from `proposals:changed`; a failed accept leaves
      // the card exactly where it was.
    } finally {
      setBusyId(null);
    }
  };

  const dismiss = async (proposal: Proposal, reason: string) => {
    setBusyId(proposal.id);
    try {
      await dismissProposal(proposal.id, reason || undefined);
    } catch {
      // Same as above — the card stays until the host says otherwise.
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className={styles.cards}>
      {proposals.map((proposal) => {
        const project = projectName(proposal.repo_root);
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
                <Badge tone={ACTION_TONES[proposal.recommended_action]}>
                  {ACTION_LABELS[proposal.recommended_action]}
                </Badge>
                {project && <Badge tone="neutral">{project}</Badge>}
                {automation && <Badge tone="neutral">{automation.name}</Badge>}
              </>
            }
            onDismiss={(reason) => {
              dismiss(proposal, reason).catch(() => undefined);
            }}
            onOpenSource={
              source
                ? () => {
                    // Client-side by design: the issue opens in *your*
                    // browser even when the proposal came from another host.
                    openExternalUrl(source.url).catch(() => undefined);
                  }
                : undefined
            }
            onStart={() => {
              start(proposal).catch(() => undefined);
            }}
            rationale={proposal.rationale || undefined}
            sourceLabel={source?.external_id}
            summary={proposal.summary}
            title={proposal.title}
          />
        );
      })}
    </div>
  );
}
