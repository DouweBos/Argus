/**
 * The inbox's actionable half, on home.
 *
 * Home is where you land, so the decisions Argus is waiting on belong here —
 * not one navigation away. The cards are the inbox's own, so accepting or
 * dismissing from here is the same act, with the same guarantees.
 */

import { openInbox } from "../../../stores/proposalStore";
import { FailedRuns } from "../../inbox/InboxScreen/FailedRuns";
import { PendingProposals } from "../../inbox/InboxScreen/PendingProposals";
import { useInboxItems } from "../../inbox/useInboxItems";
import styles from "./HomeScreen.module.css";

/** Enough to act on without home turning into the inbox. */
const MAX_PROPOSALS = 2;
const MAX_FAILED = 2;

export function NeedsYouSection() {
  const { failed, pending } = useInboxItems();
  const waiting = pending.length + failed.length;
  if (waiting === 0) {
    return null;
  }

  const proposals = pending.slice(0, MAX_PROPOSALS);
  const runs = failed.slice(0, MAX_FAILED);
  const hidden = waiting - proposals.length - runs.length;

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.eyebrow}>Needs you</span>
        <span className={styles.attentionCount}>{waiting} waiting</span>
        <button
          type="button"
          className={styles.linkBtn}
          onClick={() => openInbox()}
        >
          Open inbox
        </button>
      </div>
      <div className={styles.needsYou}>
        {proposals.length > 0 && <PendingProposals proposals={proposals} />}
        {runs.length > 0 && <FailedRuns runs={runs} />}
        {hidden > 0 && (
          <button
            type="button"
            className={styles.moreLink}
            onClick={() => openInbox()}
          >
            {hidden} more in the inbox
          </button>
        )}
      </div>
    </div>
  );
}
