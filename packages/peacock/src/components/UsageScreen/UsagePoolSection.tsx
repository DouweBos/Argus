import { useState } from "react";
import { Card } from "../Card/Card";
import {
  PooledUsageBar,
  PooledUsageHatch,
} from "../PooledUsageBar/PooledUsageBar";
import { SectionPanel } from "../SectionPanel/SectionPanel";
import { UsageMeter, type UsageTone } from "../UsageMeter/UsageMeter";
import {
  AccountWindows,
  type RetryProps,
  type UsageAccountData,
} from "./UsageAccountWindows";
import styles from "./UsageScreen.module.css";

export interface UsagePoolSegmentData {
  accountId: string;
  label: string;
  plan: string | null;
  present: boolean;
  /** Its own window's used share, 0–1. */
  used: number;
  restoring: boolean;
  resetHint: string | null;
  /** "Work · max · 38% left · Resets in 2h 13m". */
  detail: string;
}

/** One window pooled across a provider's accounts, from `usagePoolViews` in `@argus/client-core`. */
export interface UsagePoolData {
  id: string;
  label: string;
  /** "62% left" across the pool. */
  value: string;
  progress: number;
  tone: UsageTone;
  /** What the next reset gives back; null when no reset is known. */
  next: string | null;
  segments: UsagePoolSegmentData[];
}

export interface UsagePoolSectionProps extends RetryProps {
  title: string;
  pools: UsagePoolData[];
  /** Every account, pooled or not, as a row that opens its own meters. */
  accounts: UsageAccountData[];
}

function accountSummary(account: UsageAccountData): string {
  if (account.state !== "ok") {
    return account.state === "unsupported"
      ? "No plan limits"
      : "No limits read";
  }

  return account.windows.map((w) => `${w.label} ${w.value}`).join(" · ");
}

/** A provider with several accounts: one pooled card per window, then a row per account. */
export function UsagePoolSection({
  title,
  pools,
  accounts,
  onRetry,
  retrying,
}: UsagePoolSectionProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const picked = accounts.find((a) => a.id === selected) ?? null;

  return (
    <SectionPanel
      meta={`${String(accounts.length)} accounts, pooled`}
      plain
      title={title}
    >
      <div className={styles.grid}>
        {pools.map((pool) => {
          const segment = pool.segments.find((s) => s.accountId === selected);

          return (
            <Card key={pool.id}>
              <div className={styles.pool}>
                <UsageMeter
                  label={pool.label}
                  size="lg"
                  tone={pool.tone}
                  value={pool.value}
                />
                <PooledUsageBar
                  aria-label={`${pool.label} across accounts`}
                  segments={pool.segments.map((s) => ({
                    id: s.accountId,
                    label: s.label,
                    present: s.present,
                    used: s.used,
                    restoring: s.restoring,
                    title: s.detail,
                  }))}
                  selectedId={selected}
                  tone={pool.tone}
                  onSelect={setSelected}
                />
                {segment ? (
                  <p className={styles.poolHint}>{segment.detail}</p>
                ) : (
                  pool.next && (
                    <p className={styles.poolHint}>
                      <PooledUsageHatch tone={pool.tone} /> {pool.next}
                    </p>
                  )
                )}
              </div>
            </Card>
          );
        })}
      </div>
      <div className={styles.accountRows}>
        {accounts.map((account) => (
          <div key={account.id}>
            <button
              aria-expanded={account.id === selected}
              className={[
                styles.accountRow,
                account.id === selected ? styles.accountRowSelected : "",
              ]
                .filter(Boolean)
                .join(" ")}
              type="button"
              onClick={() =>
                setSelected(account.id === selected ? null : account.id)
              }
            >
              <span className={styles.accountName}>{account.label}</span>
              {account.plan && (
                <span className={styles.accountPlan}>{account.plan}</span>
              )}
              <span className={styles.accountSummary}>
                {accountSummary(account)}
              </span>
            </button>
            {picked?.id === account.id && (
              <div className={styles.accountDetail}>
                <AccountWindows
                  account={account}
                  onRetry={onRetry}
                  retrying={retrying}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </SectionPanel>
  );
}
