import type { AgentStatus } from "../../lib/agentStatus";
import type { HTMLAttributes, ReactNode } from "react";
import { CommitIcon, SparkleIcon, WarningIcon } from "../../icons/HomeIcons";
import { TerminalIcon, MergeIcon } from "../../icons/Icons";
import styles from "./FeedItem.module.css";

export type FeedKind =
  | "build"
  | "commit"
  | "merge"
  | "permission"
  | "tool_call";

export interface FeedItemProps extends HTMLAttributes<HTMLDivElement> {
  kind: FeedKind;
  /** Detail status for the row — drives color accents. */
  status?: AgentStatus;
  project: ReactNode;
  agent: ReactNode;
  text: ReactNode;
  /** Shown in the top-right timestamp slot (e.g., "just now", "12s"). */
  time?: ReactNode;
  /** Render text in monospace (used for tool calls, permission asks, builds). */
  mono?: boolean;
  /** Slot for action buttons, typically rendered when status === "pending". */
  actions?: ReactNode;
}

const KIND_ICON: Record<FeedKind, ReactNode> = {
  tool_call: <TerminalIcon size={13} />,
  permission: <WarningIcon size={13} />,
  commit: <CommitIcon size={13} />,
  build: <WarningIcon size={13} />,
  merge: <MergeIcon size={13} />,
};

function toneClass(kind: FeedKind, status?: AgentStatus): string {
  if (status === "pending") {
    return "pending";
  }
  if (status === "running") {
    return "running";
  }
  if (status === "error") {
    return "error";
  }
  if (kind === "merge") {
    return "merge";
  }

  return "";
}

export function FeedItem({
  kind,
  status,
  project,
  agent,
  text,
  time,
  mono,
  actions,
  className,
  ...rest
}: FeedItemProps) {
  const tone = toneClass(kind, status);

  return (
    <div
      className={[styles.item, tone && styles[tone], className]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      <div
        className={[styles.icon, tone && styles[tone]]
          .filter(Boolean)
          .join(" ")}
      >
        {KIND_ICON[kind] ?? <SparkleIcon size={13} />}
      </div>
      <div className={styles.body}>
        <div className={styles.top}>
          <span className={styles.projectChip}>{project}</span>
          <span className={styles.agentChip}>/ {agent}</span>
        </div>
        <div
          className={[styles.text, mono ? styles.textMono : ""]
            .filter(Boolean)
            .join(" ")}
        >
          {text}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
      {(time || status) && (
        <div className={styles.meta}>
          {time}
          {status && (
            <>
              <br />
              <span className={styles.metaStatus}>{status}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
