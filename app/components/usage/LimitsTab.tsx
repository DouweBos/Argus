import type { UsageLimitsState } from "./useUsageLimits";
import {
  Button,
  EmptyState,
  Icons,
  SectionPanel,
  Spinner,
} from "@argus/peacock";
import { AccountLimits } from "./AccountLimits";
import styles from "./UsageScreen.module.css";

/** `/usage` — each Claude account's plan windows and how much of each is left. */
export function LimitsTab({ limits }: { limits: UsageLimitsState }) {
  const { data, error, loading, now, refresh, refreshing } = limits;

  if (!data) {
    if (loading) {
      return (
        <div className={styles.loading}>
          <Spinner />
        </div>
      );
    }

    return (
      <EmptyState
        action={
          <Button disabled={refreshing} onClick={refresh} size="sm">
            Try again
          </Button>
        }
        body={error ?? undefined}
        icon={<Icons.WarningIcon size={18} />}
        title="Couldn't load plan limits"
      />
    );
  }

  if (data.accounts.length === 0) {
    return (
      <EmptyState
        body="Sign in to Claude in Settings to see your plan limits here."
        icon={<Icons.GaugeIcon size={18} />}
        title="No Claude account"
      />
    );
  }

  const [only] = data.accounts;
  const retry = { now, onRetry: refresh, retrying: refreshing };

  return (
    <div className={styles.sections}>
      {error && <p className={styles.error}>{error}</p>}
      {data.accounts.length === 1 && only ? (
        <AccountLimits account={only} {...retry} />
      ) : (
        data.accounts.map((account) => (
          <SectionPanel
            key={account.account_id}
            meta={account.subscription_type ?? undefined}
            plain
            title={account.label}
          >
            <AccountLimits account={account} {...retry} />
          </SectionPanel>
        ))
      )}
    </div>
  );
}
