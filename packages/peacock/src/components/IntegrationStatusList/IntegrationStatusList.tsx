import type { ReactNode } from "react";
import { FigmaIcon, LinearIcon, WarningIcon } from "../../icons/Icons";
import { Badge } from "../Badge/Badge";
import { Button } from "../Button/Button";
import { EmptyState } from "../EmptyState/EmptyState";
import { Spinner } from "../Spinner/Spinner";
import styles from "./IntegrationStatusList.module.css";

export interface IntegrationStatusRowData {
  /** `linear`, `figma`, …: picks the icon. */
  id: string;
  name: string;
  /** "Connected", "Reconnect" or "Not connected". */
  stateLabel: string;
  tone: "neutral" | "success" | "warning";
  /** "Ada Lovelace · Acme", when connected. */
  account: string | null;
}

export interface IntegrationStatusListProps {
  /** Null while loading. */
  integrations: IntegrationStatusRowData[] | null;
  error?: string | null;
  onRetry?: () => void;
}

const ICON: Record<string, ReactNode> = {
  linear: <LinearIcon size={14} />,
  figma: <FigmaIcon size={14} />,
};

/** Read-only: which integrations a computer has connected, and as whom. */
export function IntegrationStatusList({
  integrations,
  error,
  onRetry,
}: IntegrationStatusListProps) {
  if (integrations === null) {
    return error ? (
      <EmptyState
        action={
          onRetry && (
            <Button size="sm" variant="secondary" onClick={onRetry}>
              Retry
            </Button>
          )
        }
        body={error}
        icon={<WarningIcon size={22} />}
        title="Couldn't load integrations"
      />
    ) : (
      <div className={styles.loading}>
        <Spinner size="sm" />
        <span>Checking integrations…</span>
      </div>
    );
  }
  if (integrations.length === 0) {
    return <p className={styles.empty}>No integrations on this computer.</p>;
  }

  return (
    <ul className={styles.rows}>
      {integrations.map((i) => (
        <li key={i.id} className={styles.row}>
          <span className={styles.icon}>{ICON[i.id]}</span>
          <div className={styles.text}>
            <span className={styles.name}>{i.name}</span>
            {i.account && <span className={styles.account}>{i.account}</span>}
          </div>
          <Badge size="tag" tone={i.tone}>
            {i.stateLabel}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
