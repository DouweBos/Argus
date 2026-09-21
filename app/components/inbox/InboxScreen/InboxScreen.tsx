import {
  Button,
  EmptyState,
  Icons,
  SectionPanel,
  Spinner,
} from "@argus/peacock";
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
import { FailedRuns } from "./FailedRuns";
import styles from "./InboxScreen.module.css";
import { PendingProposals } from "./PendingProposals";
import { StartedWork } from "./StartedWork";

/**
 * `/inbox` — what Argus wants from you, grouped by what you would do about
 * it rather than by which automation produced it. Decisions first: a pending
 * proposal outranks a branch that is merely waiting, which outranks a run
 * that already failed.
 */
export function InboxScreen() {
  const { failed, pending, started } = useInboxItems();
  const all = useProposals();
  const loading = useProposalsLoading();
  const error = useProposalsError();
  const automations = useAutomations();

  const empty =
    pending.length === 0 && started.length === 0 && failed.length === 0;

  let body = (
    <div className={styles.sections}>
      {pending.length > 0 && (
        <SectionPanel meta={`${pending.length} waiting`} plain title="Decide">
          <PendingProposals proposals={pending} />
        </SectionPanel>
      )}
      {started.length > 0 && (
        <SectionPanel meta={`${started.length}`} plain title="Argus is on it">
          <StartedWork proposals={started} />
        </SectionPanel>
      )}
      {failed.length > 0 && (
        <SectionPanel meta={`${failed.length}`} plain title="Needs a look">
          <FailedRuns runs={failed} />
        </SectionPanel>
      )}
    </div>
  );

  if (empty) {
    body =
      loading && all.length === 0 ? (
        <div className={styles.loading}>
          <Spinner />
        </div>
      ) : (
        <EmptyState
          action={
            <Button onClick={() => openAutomations()} size="sm">
              {automations.length === 0
                ? "Set up an automation"
                : "Automations"}
            </Button>
          }
          body={
            automations.length === 0
              ? "Turn on an automation and whatever it finds — issues to pick up, work it has already started — shows up here."
              : "Your automations have nothing waiting on you. This is what a quiet inbox looks like."
          }
          icon={<Icons.EnvelopeIcon size={18} />}
          title="Nothing needs you"
        />
      );
  }

  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <h1 className={styles.titleHeading}>Inbox</h1>
        <span className={styles.sub}>
          {pending.length === 0
            ? "No decisions waiting"
            : `${pending.length} decision${pending.length === 1 ? "" : "s"} waiting`}
        </span>
      </header>

      {error && <p className={styles.error}>{error}</p>}

      {body}
    </div>
  );
}
