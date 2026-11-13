import { WarningIcon } from "../../icons/Icons";
import { Button } from "../Button/Button";
import { Card } from "../Card/Card";
import { EmptyState } from "../EmptyState/EmptyState";
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

export interface RetryProps {
  onRetry: () => void;
  retrying: boolean;
}

/** One account's or runner's windows as cards, or why there are none. */
export function AccountWindows({
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
