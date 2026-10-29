import type { ButtonHTMLAttributes, ReactNode } from "react";
import { UsageMeter, type UsageTone } from "../UsageMeter/UsageMeter";
import styles from "./PlanLimitsStrip.module.css";

export interface PlanLimit {
  id: string;
  /** Short name of the window or account, e.g. "Session", "Weekly". */
  label: ReactNode;
  /** Usually "73% left". */
  value: ReactNode;
  /** Share of the window used, 0–1. */
  progress: number;
  tone?: UsageTone;
  /** Shown on hover, e.g. "Resets in 4h 29m". */
  title?: string;
}

export interface PlanLimitsStripProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type"
> {
  limits: PlanLimit[];
}

/** A row of thin plan-limit meters that opens the full usage view. */
export function PlanLimitsStrip({
  limits,
  className,
  ...rest
}: PlanLimitsStripProps) {
  return (
    <button
      type="button"
      className={[styles.strip, className].filter(Boolean).join(" ")}
      {...rest}
    >
      {limits.map((l) => (
        <UsageMeter
          key={l.id}
          className={styles.meter}
          label={l.label}
          progress={l.progress}
          title={l.title}
          tone={l.tone}
          value={l.value}
        />
      ))}
    </button>
  );
}
