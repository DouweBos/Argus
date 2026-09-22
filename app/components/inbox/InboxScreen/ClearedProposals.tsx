import type { Proposal } from "../../../lib/types";
import { Badge, Icons, InboxItemRow } from "@argus/peacock";
import { formatRelative } from "../../../lib/automations";
import { useAutomations } from "../../../stores/automationStore";
import { openProposal } from "../../../stores/proposalStore";
import styles from "./InboxScreen.module.css";

/**
 * Decisions a later run took off your hands — the same work proposed again, or
 * a proposal whose signal went away. Listed rather than silently dropped: a
 * proposal disappearing on its own is only trustworthy if you can see it did.
 */
export function ClearedProposals({ proposals }: { proposals: Proposal[] }) {
  const automations = useAutomations();

  return (
    <div className={styles.rows}>
      {proposals.map((proposal) => {
        const automation = automations.find(
          (a) => a.id === proposal.automation_id,
        );

        return (
          <InboxItemRow
            key={proposal.id}
            leading={<Icons.CheckIcon size={12} />}
            meta={
              <Badge tone="neutral">
                {proposal.status === "superseded" ? "replaced" : "withdrawn"}
              </Badge>
            }
            onOpen={() => openProposal(proposal.id)}
            subtitle={
              <>
                {proposal.cleared_reason ?? "No reason recorded."}
                {automation && ` · ${automation.name}`}
                {proposal.cleared_at !== null &&
                  ` · ${formatRelative(proposal.cleared_at)}`}
              </>
            }
            title={proposal.title}
          />
        );
      })}
    </div>
  );
}
