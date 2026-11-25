import type { LoadPhase } from "@argus/client-core";
import { ClockIcon, PauseIcon, PersonIcon } from "../../icons/Icons";
import { Badge, type BadgeTone } from "../Badge/Badge";
import { Button } from "../Button/Button";
import { EmptyState } from "../EmptyState/EmptyState";
import { Spinner } from "../Spinner/Spinner";
import styles from "./UpcomingRunsView.module.css";

export type UpcomingWaitTone = "muted" | "warning";

export interface UpcomingRunRowProps {
  id: string;
  name: string;
  /** Whose run it is: "CI Fixer's duty", "Automation". */
  subtitle: string;
  /** When it fires: "in 2h · at 14:00". */
  when: string;
  /** What holds it up, when something does. */
  wait?: { label: string; tone: UpcomingWaitTone } | null;
  /** A teammate's duty, for its icon. */
  duty?: boolean;
  onOpen: () => void;
}

const WAIT_TONE: Record<UpcomingWaitTone, BadgeTone> = {
  muted: "neutral",
  warning: "warning",
};

/** One automation or duty's next run, and what it waits on. */
export function UpcomingRunRow({
  duty,
  name,
  onOpen,
  subtitle,
  wait,
  when,
}: UpcomingRunRowProps) {
  let icon = <ClockIcon size={14} />;
  if (wait?.tone === "muted") {
    icon = <PauseIcon size={13} />;
  } else if (duty) {
    icon = <PersonIcon size={14} />;
  }

  return (
    <button type="button" className={styles.row} onClick={onOpen}>
      <span className={styles.icon}>{icon}</span>
      <span className={styles.main}>
        <span className={styles.name}>{name}</span>
        <span className={styles.subtitle}>{subtitle}</span>
      </span>
      {wait && (
        <Badge className={styles.wait} tone={WAIT_TONE[wait.tone]}>
          {wait.label}
        </Badge>
      )}
      <span className={styles.when}>{when}</span>
    </button>
  );
}

export interface UpcomingRunsViewProps {
  phase: LoadPhase;
  rows: UpcomingRunRowProps[];
  onRetry?: () => void;
}

/** What runs next across every automation and teammate duty, soonest first. */
export function UpcomingRunsView({
  onRetry,
  phase,
  rows,
}: UpcomingRunsViewProps) {
  if (phase.kind === "loading") {
    return (
      <div className={styles.loading}>
        <Spinner />
      </div>
    );
  }
  if (phase.kind === "failed") {
    return (
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
        title="Upcoming runs unavailable"
      />
    );
  }
  if (phase.kind === "empty") {
    return (
      <EmptyState
        body="Automations and teammate duties on a schedule show here, soonest first."
        icon={<ClockIcon size={18} />}
        title="Nothing scheduled"
      />
    );
  }

  return (
    <div className={styles.list}>
      {rows.map((row) => (
        <UpcomingRunRow key={row.id} {...row} />
      ))}
    </div>
  );
}
