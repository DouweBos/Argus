import { GaugeIcon, WarningIcon } from "../../icons/Icons";
import { Button } from "../Button/Button";
import { Card } from "../Card/Card";
import { EmptyState } from "../EmptyState/EmptyState";
import { SectionPanel } from "../SectionPanel/SectionPanel";
import { Spinner } from "../Spinner/Spinner";
import { UsageMeter, type UsageTone } from "../UsageMeter/UsageMeter";
import styles from "./UsageScreen.module.css";

/** One plan window; `progress` is the share used, so a full bar is spent. */
export interface UsageWindowRowData {
  id: string;
  label: string;
  /** "73% left". */
  value: string;
  progress: number;
  tone: UsageTone;
  hint: string | null;
  aside: string | null;
}

export interface UsageAccountData {
  id: string;
  label: string;
  plan: string | null;
  state: "failed" | "none" | "ok" | "unsupported";
  /** Showing the last known values: the latest check failed. */
  stale: boolean;
  /** Why there are no windows, in the runner's words; Claude's copy when absent. */
  message?: string | null;
  windows: UsageWindowRowData[];
}

interface RetryProps {
  onRetry: () => void;
  retrying: boolean;
}

export interface UsageLimitsPanelProps extends RetryProps {
  /** Null until the first answer. Rows come from `usageAccountViews` in `@argus/client-core`. */
  accounts: UsageAccountData[] | null;
  /** Other runners' plan limits, from `usageRunnerLimitViews`; one group each. */
  runners?: UsageAccountData[];
  loading: boolean;
  error: string | null;
  /** Where to go to sign in, when there is no account and no runner. */
  noAccountHint?: string;
}

function AccountWindows({
  account,
  onRetry,
  retrying,
}: RetryProps & { account: UsageAccountData }) {
  switch (account.state) {
    case "unsupported":
      return (
        <p className={styles.note}>
          {account.message ??
            "No plan limits for this account (API key or Console sign-in)."}
        </p>
      );
    case "none":
      return (
        <p className={styles.note}>
          {account.message ?? "This plan reports no limits."}
        </p>
      );
    case "failed":
      return (
        <EmptyState
          action={
            <Button disabled={retrying} onClick={onRetry} size="sm">
              Try again
            </Button>
          }
          body={
            account.message ??
            "Claude did not answer the limits check. It may be signed out or offline."
          }
          icon={<WarningIcon size={18} />}
          title="Couldn't load plan limits"
        />
      );
    case "ok":
      return (
        <>
          {account.stale && (
            <p className={styles.error}>
              Couldn’t refresh these limits; showing the last known values.
            </p>
          )}
          <div className={styles.grid}>
            {account.windows.map((w) => (
              <Card key={w.id}>
                <UsageMeter
                  aside={w.aside}
                  hint={w.hint}
                  label={w.label}
                  progress={w.progress}
                  size="lg"
                  tone={w.tone}
                  value={w.value}
                />
              </Card>
            ))}
          </div>
        </>
      );
  }
}

/** Each Claude account's and each runner's plan windows and how much of each is left. */
export function UsageLimitsPanel({
  accounts,
  runners = [],
  loading,
  error,
  onRetry,
  retrying,
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

  return (
    <div className={styles.sections}>
      {error && <p className={styles.error}>{error}</p>}
      {bare && only ? (
        <AccountWindows account={only} {...retry} />
      ) : (
        accounts.map((account) => (
          <SectionPanel
            key={account.id}
            meta={account.plan ?? undefined}
            plain
            title={accounts.length === 1 ? "Claude" : account.label}
          >
            <AccountWindows account={account} {...retry} />
          </SectionPanel>
        ))
      )}
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
