import type { LoadPhase } from "@argus/client-core";
import { ClockIcon, PlayIcon, PlusIcon, SparklesIcon } from "../../icons/Icons";
import {
  AutomationRow,
  type AutomationRowProps,
} from "../AutomationRow/AutomationRow";
import { Banner } from "../Banner/Banner";
import { Button } from "../Button/Button";
import { EmptyState } from "../EmptyState/EmptyState";
import { Spinner } from "../Spinner/Spinner";
import styles from "./AutomationsListView.module.css";

export interface AutomationsListViewProps {
  phase: LoadPhase;
  /** A refresh that failed behind rows already shown. */
  error?: string | null;
  rows: (AutomationRowProps & { id: string })[];
  /** The page title; omit where the shell titles the screen. */
  header?: boolean;
  /** Quick runs so far, for the button's count. */
  quickRunCount?: number;
  onQuickRun: () => void;
  /** Omit both where this client may not create automations. */
  onDescribe?: () => void;
  onNew?: () => void;
  /** Creating one is in flight. */
  creating?: boolean;
  onRetry?: () => void;
}

/** Every automation on the computer, and the ways to make or run one. */
export function AutomationsListView({
  creating,
  error,
  header,
  onDescribe,
  onNew,
  onQuickRun,
  onRetry,
  phase,
  quickRunCount = 0,
  rows,
}: AutomationsListViewProps) {
  const actions = (
    <div className={styles.actions}>
      <Button
        leading={<PlayIcon size={11} />}
        size="sm"
        variant="secondary"
        onClick={onQuickRun}
      >
        Quick run{quickRunCount > 0 ? ` (${quickRunCount})` : ""}
      </Button>
      {onDescribe && (
        <Button
          leading={<SparklesIcon size={11} />}
          size="sm"
          variant="secondary"
          onClick={onDescribe}
        >
          Describe it
        </Button>
      )}
      {onNew && (
        <Button
          disabled={creating}
          leading={<PlusIcon size={11} />}
          size="sm"
          onClick={onNew}
        >
          New automation
        </Button>
      )}
    </div>
  );

  let body;
  if (phase.kind === "loading") {
    body = (
      <div className={styles.loading}>
        <Spinner />
      </div>
    );
  } else if (phase.kind === "failed") {
    body = (
      <EmptyState
        action={
          onRetry && (
            <Button size="sm" onClick={onRetry}>
              Try again
            </Button>
          )
        }
        body={phase.error}
        icon={<ClockIcon size={18} />}
        title="Automations unavailable"
      />
    );
  } else if (phase.kind === "empty") {
    body = (
      <EmptyState
        action={
          onDescribe && (
            <Button size="sm" onClick={onDescribe}>
              Describe it
            </Button>
          )
        }
        body="An automation is a playbook plus a clock: it wakes an agent up on a schedule, or when you press Run. To run something once without saving it, use a quick run."
        icon={<ClockIcon size={18} />}
        title="No automations yet"
      />
    );
  } else {
    body = (
      <div className={styles.list}>
        {rows.map(({ id, ...row }) => (
          <AutomationRow key={id} {...row} />
        ))}
      </div>
    );
  }

  return (
    <div className={styles.view}>
      {header ? (
        <header className={styles.head}>
          <h1 className={styles.title}>Automations</h1>
          <span className={styles.sub}>
            {rows.length} automation{rows.length === 1 ? "" : "s"}
          </span>
          <span className={styles.spacer} />
          {actions}
        </header>
      ) : (
        actions
      )}
      {error && phase.kind === "content" && (
        <Banner tone="error">{error}</Banner>
      )}
      {body}
    </div>
  );
}
