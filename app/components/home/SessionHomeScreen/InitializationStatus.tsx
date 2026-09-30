import { CalloutCard, ProgressBar, Spinner } from "@argus/peacock";
import { setupFraction } from "../../../lib/sessionProgress";
import { useSetupProgressBySessionId } from "../../../stores/sessionStore";
import styles from "./InitializationStatus.module.css";

interface InitializationStatusProps {
  sessionId: string;
}

type SetupPhase = "command" | "copy" | "matching" | "symlink";

const PHASE_LABEL: Record<SetupPhase, string> = {
  matching: "Matching files",
  copy: "Copying",
  symlink: "Linking",
  command: "Running setup commands",
};

/**
 * Compact status widget rendered on the session home screen while the
 * worktree is still being set up. Mirrors the data emitted to the "Setup"
 * terminal: which step we're on, what's left, and the current item.
 */
export function InitializationStatus({ sessionId }: InitializationStatusProps) {
  const setupProgressById = useSetupProgressBySessionId();
  const setupProgress = setupProgressById[sessionId];

  if (!setupProgress) {
    return (
      <CalloutCard
        tone="accent"
        leading={<Spinner size="sm" />}
        title="Initializing session"
        meta="Preparing the worktree…"
      >
        <ProgressBar indeterminate aria-label="Initialization progress" />
      </CalloutCard>
    );
  }

  const { current, total, item, phase, detail } = setupProgress;
  const fraction = setupFraction(setupProgress);
  const knownTotal = fraction !== null;
  const remaining = knownTotal ? Math.max(total - current, 0) : 0;
  const phaseLabel = phase ? PHASE_LABEL[phase] : "Initializing";
  const stepLine = knownTotal
    ? `Step ${current} of ${total} · ${remaining} remaining`
    : "Discovering steps…";

  return (
    <CalloutCard
      tone="accent"
      leading={<Spinner size="sm" />}
      title={phaseLabel}
      meta={stepLine}
    >
      <div className={styles.body}>
        <ProgressBar
          progress={fraction ?? 0}
          indeterminate={!knownTotal}
          aria-label="Initialization progress"
        />
        <p className={styles.item} title={item}>
          <span className={styles.itemText}>{item}</span>
        </p>
        {detail && (
          <p className={styles.item} title={detail}>
            <span className={styles.itemText}>{detail}</span>
          </p>
        )}
      </div>
    </CalloutCard>
  );
}
