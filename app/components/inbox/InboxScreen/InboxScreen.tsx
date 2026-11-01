import { isInboxEmpty, loadPhase } from "@argus/client-core";
import { Button, InboxView } from "@argus/peacock";
import {
  openAutomations,
  useAutomations,
} from "../../../stores/automationStore";
import {
  useProposals,
  useProposalsError,
  useProposalsLoading,
} from "../../../stores/proposalStore";
import { useInboxItems } from "../useInboxItems";
import styles from "./InboxScreen.module.css";
import { PendingProposals } from "./PendingProposals";
import {
  useClearedItems,
  useFailedRunItems,
  useReportItems,
  useStartedItems,
} from "./inboxRows";

/**
 * `/inbox` — what Argus wants from you, grouped by what you would do about
 * it rather than by which automation produced it. The layout is Peacock's
 * `InboxView`, shared with the web client.
 */
export function InboxScreen() {
  const items = useInboxItems();
  const all = useProposals();
  const loading = useProposalsLoading();
  const error = useProposalsError();
  const automations = useAutomations();
  const reports = useReportItems(items.reports);
  const started = useStartedItems(items.started);
  const failed = useFailedRunItems(items.failed);
  const cleared = useClearedItems(items.cleared);
  const phase = loadPhase(
    { loaded: !loading || all.length > 0, error: null },
    isInboxEmpty(items),
  );

  return (
    <div className={styles.screen}>
      <InboxView
        header
        cleared={cleared}
        decide={<PendingProposals proposals={items.pending} />}
        emptyAction={
          <Button size="sm" onClick={() => openAutomations()}>
            {automations.length === 0 ? "Set up an automation" : "Automations"}
          </Button>
        }
        emptyBody={
          automations.length === 0
            ? "Turn on an automation and whatever it finds — issues to pick up, work it has already started — shows up here."
            : "Your automations have nothing waiting on you. This is what a quiet inbox looks like."
        }
        error={error}
        failed={failed}
        pendingCount={items.pending.length}
        phase={phase}
        reports={reports}
        started={started}
      />
    </div>
  );
}
