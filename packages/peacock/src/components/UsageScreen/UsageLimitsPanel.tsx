import { GaugeIcon, WarningIcon } from "../../icons/Icons";
import { Button } from "../Button/Button";
import { EmptyState } from "../EmptyState/EmptyState";
import { SectionPanel } from "../SectionPanel/SectionPanel";
import { Spinner } from "../Spinner/Spinner";
import {
  AccountWindows,
  type RetryProps,
  type UsageAccountData,
} from "./UsageAccountWindows";
import { type UsagePoolData, UsagePoolSection } from "./UsagePoolSection";
import styles from "./UsageScreen.module.css";

export type {
  UsageAccountData,
  UsageWindowRowData,
} from "./UsageAccountWindows";

export interface UsageLimitsPanelProps extends RetryProps {
  /** Null until the first answer. Rows come from `usageAccountViews` in `@argus/client-core`. */
  accounts: UsageAccountData[] | null;
  /** Other runners' plan limits, from `usageRunnerLimitViews`; one group each. */
  runners?: UsageAccountData[];
  loading: boolean;
  error: string | null;
  /** Where to go to sign in, when there is no account and no runner. */
  noAccountHint?: string;
  /**
   * The Claude accounts pooled per window, from `usagePoolViews`; null keeps
   * one group of meters per account.
   */
  pools?: UsagePoolData[] | null;
}

/** Each Claude account's and each runner's plan windows and how much of each is left. */
export function UsageLimitsPanel({
  accounts,
  runners = [],
  loading,
  error,
  onRetry,
  retrying,
  pools = null,
  noAccountHint = "Sign in to Claude in Settings, or to a runner with a plan, to see its limits here.",
}: UsageLimitsPanelProps) {
  if (!accounts) {
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
          <Button disabled={retrying} onClick={onRetry} size="sm">
            Try again
          </Button>
        }
        body={error ?? undefined}
        icon={<WarningIcon size={18} />}
        title="Couldn't load plan limits"
      />
    );
  }

  if (accounts.length === 0 && runners.length === 0) {
    return (
      <EmptyState
        body={noAccountHint}
        icon={<GaugeIcon size={18} />}
        title="No plan limits"
      />
    );
  }

  const [only] = accounts;
  const retry = { onRetry, retrying };
  // A lone Claude account needs no heading until runner groups sit beside it.
  const bare = accounts.length === 1 && runners.length === 0;
  const claude = () => {
    if (pools) {
      return (
        <UsagePoolSection
          accounts={accounts}
          pools={pools}
          title="Claude"
          {...retry}
        />
      );
    }
    if (bare && only) {
      return <AccountWindows account={only} {...retry} />;
    }

    return accounts.map((account) => (
      <SectionPanel
        key={account.id}
        meta={account.plan ?? undefined}
        plain
        title={accounts.length === 1 ? "Claude" : account.label}
      >
        <AccountWindows account={account} {...retry} />
      </SectionPanel>
    ));
  };

  return (
    <div className={styles.sections}>
      {error && <p className={styles.error}>{error}</p>}
      {claude()}
      {runners.map((runner) => (
        <SectionPanel
          key={`runner:${runner.id}`}
          meta={runner.plan ?? undefined}
          plain
          title={runner.label}
        >
          <AccountWindows account={runner} {...retry} />
        </SectionPanel>
      ))}
    </div>
  );
}
