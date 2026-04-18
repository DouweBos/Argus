import type { HTMLAttributes, ReactNode } from "react";
import {
  agentStatusPulse,
  agentStatusTone,
  type AgentStatus,
} from "../../lib/agentStatus";
import { StatusDot } from "../Badge/Badge";
import styles from "./AgentRow.module.css";

function defaultMeta(status: AgentStatus): string {
  if (status === "pending") {
    return "waiting";
  }
  if (status === "error") {
    return "blocked";
  }

  return "idle";
}

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
  const metaText = meta ?? defaultMeta(status);

  return (
    <div className={classes} {...rest}>
      <StatusDot
        tone={agentStatusTone(status)}
        pulse={agentStatusPulse(status)}
      />
      <div className={styles.info}>
        <div className={styles.top}>
          <span>{name}</span>
          {project != null && (
            <span className={styles.project}>· {project}</span>
          )}
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
