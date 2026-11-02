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
  windows: UsageWindowRowData[];
}

interface RetryProps {
  onRetry: () => void;
  retrying: boolean;
}

export interface UsageLimitsPanelProps extends RetryProps {
  /** Null until the first answer. Rows come from `usageAccountViews` in `@argus/client-core`. */
  accounts: UsageAccountData[] | null;
  loading: boolean;
  error: string | null;
  /** Where to go to sign in, when there is no account. */
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
          No plan limits for this account (API key or Console sign-in).
        </p>
      );
    case "none":
      return <p className={styles.note}>This plan reports no limits.</p>;
    case "failed":
      return (
        <EmptyState
          action={
            <Button disabled={retrying} onClick={onRetry} size="sm">
              Try again
            </Button>
          }
          body="Claude did not answer the limits check. It may be signed out or offline."
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

/** Each Claude account's plan windows and how much of each is left. */
export function UsageLimitsPanel({
  accounts,
  loading,
  error,
  onRetry,
  retrying,
  noAccountHint = "Sign in to Claude in Settings to see your plan limits here.",
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

  if (accounts.length === 0) {
    return (
      <EmptyState
        body={noAccountHint}
        icon={<GaugeIcon size={18} />}
        title="No Claude account"
      />
    );
  }

  const [only] = accounts;
  const retry = { onRetry, retrying };

  return (
    <div className={styles.sections}>
      {error && <p className={styles.error}>{error}</p>}
      {accounts.length === 1 && only ? (
        <AccountWindows account={only} {...retry} />
      ) : (
        accounts.map((account) => (
          <SectionPanel
            key={account.id}
            meta={account.plan ?? undefined}
            plain
            title={account.label}
          >
            <AccountWindows account={account} {...retry} />
          </SectionPanel>
        ))
      )}
    </div>
  );
}
