import type { HTMLAttributes } from "react";
import { Badge } from "../Badge/Badge";
import styles from "./ToolCallRow.module.css";

export type ToolCallStatus = "done" | "error" | "pending" | "running";

export interface ToolCallRowProps extends HTMLAttributes<HTMLDivElement> {
  tool: string;
  detail?: string;
  status: ToolCallStatus;
}

const toneByStatus = {
  running: "accent",
  pending: "warning",
  done: "neutral",
  error: "error",
} as const;

export function ToolCallRow({
  tool,
  detail,
  status,
  className,
  ...rest
}: ToolCallRowProps) {
  const classes = [
    styles.row,
    status === "pending" ? styles.pending : "",
    status === "error" ? styles.error : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} {...rest}>
      <span className={styles.dot} />
      <span className={styles.tool}>{tool}</span>
      {detail && <span className={styles.detail}>{detail}</span>}
      <Badge tone={toneByStatus[status]}>{status}</Badge>
    </div>
  );
}
