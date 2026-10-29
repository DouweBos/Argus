import type { LimitHandoffAccount } from "@argus/remote-protocol";
import { WarningIcon } from "../../icons/Icons";
import { Avatar } from "../Avatar/Avatar";
import { Button } from "../Button/Button";
import { CalloutCard } from "../CalloutCard/CalloutCard";
import { formatLimitResume } from "../LimitResumeBanner/LimitResumeBanner";
import { Spinner } from "../Spinner/Spinner";
import styles from "./LimitHandoffCard.module.css";

export interface LimitHandoffCardProps {
  /** Other signed-in accounts with usage left; the card hides when empty. */
  accounts: LimitHandoffAccount[];
  /** The account a handoff is in flight to. */
  pendingId?: string | null;
  /** Why the last handoff failed. */
  error?: string | null;
  /** Renders the buttons; omit for clients that can't control the agent. */
  onHandoff?: (accountId: string) => void;
  className?: string;
  /** Reference time, so reset times are deterministic in stories. */
  now?: Date;
}

/** "Weekly 58% left, resets at 15:02", or a plain note when the probe couldn't tell. */
export function formatHandoffUsage(
  usage: LimitHandoffAccount["usage"],
  now: Date = new Date(),
): string {
  if (!usage) {
    return "Usage unknown";
  }
  const left = Math.floor(100 - Math.min(100, Math.max(0, usage.used_percent)));
  const head = `${usage.label} ${left}% left`;

  return usage.resets_at === null
    ? head
    : `${head}, resets ${formatLimitResume(usage.resets_at, now)}`;
}

/** A chat stalled on a spent usage limit, offering the user's other accounts. */
export function LimitHandoffCard({
  accounts,
  pendingId,
  error,
  onHandoff,
  className,
  now,
}: LimitHandoffCardProps) {
  if (accounts.length === 0) {
    return null;
  }
  const busy = pendingId != null;

  return (
    <CalloutCard
      className={className}
      leading={<WarningIcon className={styles.icon} size={14} />}
      meta="Continue this chat on another of your accounts. Its plan will be used from here on."
      title="Usage limit reached"
      tone="warning"
    >
      <ul className={styles.list}>
        {accounts.map((a) => (
          <li className={styles.row} key={a.account_id}>
            <Avatar className={styles.avatar} name={a.label} size={24} />
            <div className={styles.text}>
              <span className={styles.label}>
                {a.label}
                {a.detail && <span className={styles.detail}>{a.detail}</span>}
              </span>
              <span className={styles.usage}>
                {formatHandoffUsage(a.usage, now)}
              </span>
            </div>
            {onHandoff && (
              <Button
                aria-label={`Continue on ${a.label}`}
                disabled={busy}
                leading={
                  pendingId === a.account_id ? (
                    <Spinner aria-label="Switching" size="xs" tone="muted" />
                  ) : undefined
                }
                size="sm"
                variant="secondary"
                onClick={() => onHandoff(a.account_id)}
              >
                {pendingId === a.account_id ? "Switching" : "Continue here"}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </CalloutCard>
  );
}
