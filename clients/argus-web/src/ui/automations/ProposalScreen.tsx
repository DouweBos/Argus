/**
 * `/inbox/proposals/:proposalId`: one proposal in full, and where it gets
 * decided. A dismissal or a "done" goes back to the inbox; a start follows
 * the agent it created.
 */

import { useEffect } from "react";
import { teammateThreadOrigin } from "@argus/client-core";
import { ProposalDetailView } from "@argus/peacock";
import { openAgent } from "../../routing/open";
import { appNavigate, navigateBack } from "../../routing/router";
import { useConnectionStore } from "../../stores/connection";
import { useProposalsStore } from "../../stores/proposals";
import { ProposalCardFor } from "./ProposalCardFor";
import { proposalRunScreen, proposalSourceScreen } from "./runRoute";

export function ProposalScreen({ proposalId }: { proposalId: string }) {
  const ready = useConnectionStore((s) => s.connection === "ready");
  const known = useProposalsStore(
    (s) =>
      s.detailById[proposalId] ??
      s.pending.find((p) => p.id === proposalId) ??
      s.recent.find((p) => p.id === proposalId),
  );
  const checked = useProposalsStore((s) => proposalId in s.detailById);
  const loadProposal = useProposalsStore((s) => s.loadProposal);
  // Keep the newest record: a decision elsewhere lands on the next poll.
  const status = known?.status;
  const stage = known?.start_stage;

  useEffect(() => {
    if (ready) {
      void loadProposal(proposalId);
    }
  }, [ready, proposalId, loadProposal, status, stage]);

  // A start still in flight: poll until it settles, then follow the agent.
  useEffect(() => {
    if (!ready || !stage) {
      return;
    }
    const timer = setInterval(() => void loadProposal(proposalId), 3000);

    return () => clearInterval(timer);
  }, [ready, stage, proposalId, loadProposal]);

  const back = () => navigateBack({ name: "inbox" });
  const proposal = known ?? null;
  const links = proposal
    ? [
        ...(proposal.run_id
          ? [
              {
                label: `${proposal.automation_name} — this run`,
                onClick: () =>
                  appNavigate(
                    proposalRunScreen({
                      automation_id: proposal.automation_id,
                      run_id: proposal.run_id as string,
                    }),
                  ),
              },
            ]
          : []),
        {
          label: teammateThreadOrigin(proposal.automation_id, null)
            ? "The teammate"
            : "The automation",
          onClick: () =>
            appNavigate(proposalSourceScreen(proposal.automation_id)),
        },
        ...(proposal.superseded_by
          ? [
              {
                label: "The proposal that replaced it",
                onClick: () =>
                  appNavigate({
                    name: "proposal",
                    proposalId: proposal.superseded_by as string,
                  }),
              },
            ]
          : []),
        ...(proposal.agent_id && proposal.session_id
          ? [
              {
                label: "The agent it started",
                onClick: () =>
                  openAgent({
                    agent_id: proposal.agent_id as string,
                    session_id: proposal.session_id as string,
                  }),
              },
            ]
          : []),
      ]
    : [];

  return (
    <div className="aw-automations">
      <ProposalDetailView
        card={
          proposal && (
            <ProposalCardFor
              showDecided
              afterDecide={back}
              proposal={proposal}
            />
          )
        }
        links={links}
        loading={!checked}
        // The pane has its own back; only the gone state needs a way out.
        onBack={proposal ? undefined : back}
      />
    </div>
  );
}
