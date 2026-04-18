import type { HTMLAttributes, ReactNode } from "react";
import styles from "./AgentRow.module.css";
import { StatusDot } from "../Badge/Badge";
import {
  agentStatusPulse,
  agentStatusTone,
  type AgentStatus,
} from "../../lib/agentStatus";

export interface AgentRowProps extends HTMLAttributes<HTMLDivElement> {
  name: ReactNode;
  project?: ReactNode;
  tool?: ReactNode;
  status: AgentStatus;
  model?: ReactNode;
  /** Right-side primary meta line (e.g., "~2m", "waiting", "blocked"). */
  meta?: ReactNode;
}

export function AgentRow({
  name,
  project,
  tool,
  status,
  model,
  meta,
  className,
  ...rest
}: AgentRowProps) {
  const classes = [
    styles.row,
    status === "pending" ? styles.pending : "",
    status === "error" ? styles.error : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  const metaText =
    meta ?? (status === "pending" ? "waiting" : status === "error" ? "blocked" : "idle");
  return (
    <div className={classes} {...rest}>
      <StatusDot tone={agentStatusTone(status)} pulse={agentStatusPulse(status)} />
      <div className={styles.info}>
        <div className={styles.top}>
          <span>{name}</span>
          {project != null && <span className={styles.project}>· {project}</span>}
        </div>
        {tool != null && <div className={styles.tool}>{tool}</div>}
      </div>
      <div className={styles.meta}>
        {metaText}
        {model != null && (
          <>
            <br />
            <span className={styles.model}>{model}</span>
          </>
        )}
      </div>
    </div>
  );
}
