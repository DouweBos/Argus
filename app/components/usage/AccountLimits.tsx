import type { ClaudeAccountLimits } from "../../lib/types";
import { Button, Card, EmptyState, Icons, UsageMeter } from "@argus/peacock";
import {
  limitTone,
  paceLabel,
  percentLeft,
  resetHint,
} from "../../lib/usageFormat";
import styles from "./UsageScreen.module.css";

interface AccountLimitsProps {
  account: ClaudeAccountLimits;
  now: number;
  onRetry: () => void;
  retrying: boolean;
}

/** One account's plan windows, or why there are none. */
export function AccountLimits({
  account,
  now,
  onRetry,
  retrying,
}: AccountLimitsProps) {
  if (account.status === "unsupported") {
    return (
      <p className={styles.note}>
        No plan limits for this account (API key or Console sign-in).
      </p>
    );
  }

  if (account.windows.length === 0) {
    return account.status === "failed" ? (
      <EmptyState
        action={
          <Button disabled={retrying} onClick={onRetry} size="sm">
            Try again
          </Button>
        }
        body="Claude did not answer the limits check. It may be signed out or offline."
        icon={<Icons.WarningIcon size={18} />}
        title="Couldn't load plan limits"
      />
    ) : (
      <p className={styles.note}>This plan reports no limits.</p>
    );
  }

  return (
    <>
      {account.status === "failed" && (
        <p className={styles.error}>
          Couldn’t refresh these limits; showing the last known values.
        </p>
      )}
      <div className={styles.grid}>
        {account.windows.map((w) => (
          <Card key={w.id}>
            <UsageMeter
              aside={paceLabel(w.pace)}
              hint={resetHint(w.resets_at, now)}
              label={w.label}
              progress={w.used_percent / 100}
              size="lg"
              tone={limitTone(w)}
              value={`${percentLeft(w.used_percent)}% left`}
            />
          </Card>
        ))}
      </div>
    </>
  );
}
