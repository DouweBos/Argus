import type { HTMLAttributes } from "react";
import styles from "./BranchDivergence.module.css";

export interface BranchDivergenceProps extends HTMLAttributes<HTMLSpanElement> {
  ahead?: number;
  behind?: number;
  dirty?: number;
}

/** Compact ahead/behind/dirty indicator ("↑1 ↓541 1Δ"); null when all zero. */
export function BranchDivergence({
  ahead = 0,
  behind = 0,
  dirty = 0,
  className,
  ...rest
}: BranchDivergenceProps) {
  if (ahead <= 0 && behind <= 0 && dirty <= 0) {
    return null;
  }

  return (
    <span
      className={[styles.divergence, className].filter(Boolean).join(" ")}
      {...rest}
    >
      {ahead > 0 && <span title={`${ahead} ahead`}>↑{ahead}</span>}
      {behind > 0 && <span title={`${behind} behind`}>↓{behind}</span>}
      {dirty > 0 && <span title={`${dirty} changed`}>{dirty}Δ</span>}
    </span>
  );
}
