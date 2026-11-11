import type { UsageAccountData } from "../UsageScreen/UsageAccountWindows";
import type { UsagePoolData } from "../UsageScreen/UsagePoolSection";
import { CloseIcon } from "../../icons/Icons";
import { Button } from "../Button/Button";
import { FlatIconButton } from "../FlatIconButton/FlatIconButton";
import {
  PooledUsageBar,
  PooledUsageHatch,
} from "../PooledUsageBar/PooledUsageBar";
import { Spinner } from "../Spinner/Spinner";
import { UsageMeter } from "../UsageMeter/UsageMeter";
import styles from "./AgentLimitsPanel.module.css";

export interface AgentLimitsPanelProps {
  /** The runner: "Claude Code", "Codex". */
  title: string;
  /** Before the first answer. */
  loading: boolean;
  error: string | null;
  /** Several accounts pooled per window; null shows each account's meters. */
  pools: UsagePoolData[] | null;
  accounts: UsageAccountData[];
  onDismiss: () => void;
  /** Opens the Usage screen's Limits tab. */
  onOpenUsage?: () => void;
}

function Account({
  account,
  named,
}: {
  account: UsageAccountData;
  named: boolean;
}) {
  return (
    <div className={styles.account}>
      {named && (
        <span className={styles.accountName}>
          {account.label}
          {account.plan && (
            <span className={styles.muted}> · {account.plan}</span>
          )}
        </span>
      )}
      {account.state === "ok" ? (
        account.windows.map((w) => (
          <UsageMeter
            hint={w.hint}
            key={w.id}
            label={w.label}
            progress={w.progress}
            size="row"
            tone={w.tone}
            value={w.value}
          />
        ))
      ) : (
        <span className={styles.muted}>
          {account.message ??
            (account.state === "unsupported"
              ? "No plan limits"
              : "Couldn’t read its limits")}
        </span>
      )}
    </div>
  );
}

function Pool({ pool }: { pool: UsagePoolData }) {
  return (
    <div className={styles.pool}>
      <div className={styles.poolHead}>
        <span>{pool.label}</span>
        <span className={styles.value}>{pool.value}</span>
      </div>
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
        size="sm"
        tone={pool.tone}
      />
      {pool.next && (
        <span className={styles.muted}>
          <PooledUsageHatch tone={pool.tone} /> {pool.next}
        </span>
      )}
    </div>
  );
}

/** The current agent's plan limits above the composer, from `/usage-limits`. */
export function AgentLimitsPanel({
  title,
  loading,
  error,
  pools,
  accounts,
  onDismiss,
  onOpenUsage,
}: AgentLimitsPanelProps) {
  const empty = !pools && accounts.length === 0;

  return (
    <section aria-label={`${title} plan limits`} className={styles.panel}>
      <header className={styles.head}>
        <span className={styles.title}>
          Plan limits <span className={styles.muted}>· {title}</span>
        </span>
        {onOpenUsage && (
          <Button onClick={onOpenUsage} size="sm" variant="ghost">
            Open Usage
          </Button>
        )}
        <FlatIconButton
          icon={<CloseIcon size={10} />}
          label="Dismiss"
          size="sm"
          onClick={onDismiss}
        />
      </header>
      {error && <p className={styles.error}>{error}</p>}
      {loading && empty && <Spinner />}
      {pools?.map((pool) => (
        <Pool key={pool.id} pool={pool} />
      ))}
      {!pools &&
        accounts.map((a) => (
          <Account account={a} key={a.id} named={accounts.length > 1} />
        ))}
      {!loading && empty && !error && (
        <span className={styles.muted}>No plan limits to show.</span>
      )}
    </section>
  );
}
