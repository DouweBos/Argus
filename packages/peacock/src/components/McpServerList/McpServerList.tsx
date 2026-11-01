import type { ReactNode } from "react";
import { WarningIcon } from "../../icons/Icons";
import { Banner } from "../Banner/Banner";
import { Button } from "../Button/Button";
import { EmptyState } from "../EmptyState/EmptyState";
import { Spinner } from "../Spinner/Spinner";
import { StatusBulb, type StatusBulbTone } from "../StatusBulb/StatusBulb";
import styles from "./McpServerList.module.css";

export type McpServerRowState =
  | "connected"
  | "disabled"
  | "failed"
  | "needs-auth"
  | "other"
  | "pending";

export interface McpServerRowData {
  /** The CLI's name; shown on hover. */
  name: string;
  displayName: string;
  state: McpServerRowState;
  stateLabel: string;
  /** The failure, or where it's configured and how many tools it has. */
  detail: string | null;
}

const TONE: Record<McpServerRowState, StatusBulbTone> = {
  connected: "success",
  pending: "pending",
  "needs-auth": "warning",
  failed: "error",
  disabled: "neutral",
  other: "neutral",
};

export interface McpServerListProps {
  /** Null while loading; `"unsupported"` when the agent's CLI can't report them. */
  servers: McpServerRowData[] | "unsupported" | null;
  /** Why the last load failed. */
  error?: string | null;
  onRetry?: () => void;
  /** "Running as Work", when the computer has more than one account. */
  account?: ReactNode;
}

/** The MCP servers an agent's CLI loaded and whether each one connected. */
export function McpServerList({
  servers,
  error,
  onRetry,
  account,
}: McpServerListProps) {
  const retry = onRetry && (
    <Button size="sm" variant="secondary" onClick={onRetry}>
      Retry
    </Button>
  );

  if (servers === null) {
    return error ? (
      <EmptyState
        action={retry}
        body={error}
        icon={<WarningIcon size={22} />}
        title="Couldn't load MCP servers"
      />
    ) : (
      <div className={styles.loading}>
        <Spinner size="sm" />
        <span>Checking MCP servers…</span>
      </div>
    );
  }
  if (servers === "unsupported") {
    return (
      <EmptyState
        body="This agent's CLI can't report its MCP servers."
        title="Not available"
      />
    );
  }

  return (
    <div className={styles.list}>
      {account && <div className={styles.account}>{account}</div>}
      {servers.length === 0 ? (
        <p className={styles.empty}>This agent has no MCP servers.</p>
      ) : (
        <ul className={styles.rows}>
          {servers.map((s) => (
            <li key={s.name} className={styles.row} title={s.name}>
              <StatusBulb
                pulse={s.state === "pending"}
                size="sm"
                tone={TONE[s.state]}
              />
              <div className={styles.text}>
                <span
                  className={[
                    styles.name,
                    s.state === "disabled" ? styles.dim : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {s.displayName}
                </span>
                {s.detail && (
                  <span
                    className={
                      s.state === "failed" ? styles.failure : styles.detail
                    }
                  >
                    {s.detail}
                  </span>
                )}
              </div>
              <span className={[styles.state, styles[TONE[s.state]]].join(" ")}>
                {s.stateLabel}
              </span>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <Banner tone="error" trailing={retry}>
          {error}
        </Banner>
      )}
    </div>
  );
}
