import type { UsageTone } from "../UsageMeter/UsageMeter";
import styles from "./PooledUsageBar.module.css";

/** One account's column; `used` is its own window's used share, 0–1. */
export interface PooledUsageSegment {
  id: string;
  label: string;
  /** False leaves a gap: the account has no such window. */
  present: boolean;
  used: number;
  /** Its used part comes back at the next reset: drawn hatched. */
  restoring?: boolean;
  /** Plan, what's left and the reset, on hover. */
  title: string;
}

export interface PooledUsageBarProps {
  segments: PooledUsageSegment[];
  tone?: UsageTone;
  /** The account picked, outlined across every bar it appears in. */
  selectedId?: string | null;
  /** Makes each column a button; picking the selected one clears it. */
  onSelect?: (id: string | null) => void;
  size?: "lg" | "sm";
  "aria-label": string;
}

const TONES: Record<UsageTone, string> = {
  accent: styles.accent,
  danger: styles.danger,
  warning: styles.warning,
};

/** A plan window pooled across accounts: one equal column per account, filled with what it used. */
export function PooledUsageBar({
  segments,
  tone = "accent",
  selectedId = null,
  onSelect,
  size = "lg",
  "aria-label": label,
}: PooledUsageBarProps) {
  return (
    <div
      aria-label={label}
      className={[styles.bar, TONES[tone], size === "sm" ? styles.sm : ""]
        .filter(Boolean)
        .join(" ")}
      role="group"
    >
      {segments.map((s) => {
        const pct = Math.max(0, Math.min(1, s.used)) * 100;
        const classes = [
          styles.segment,
          s.present ? "" : styles.gap,
          s.id === selectedId ? styles.selected : "",
          onSelect ? styles.interactive : "",
        ]
          .filter(Boolean)
          .join(" ");
        const fill = s.present && (
          <span
            className={[styles.fill, s.restoring ? styles.restoring : ""]
              .filter(Boolean)
              .join(" ")}
            style={{ width: `${pct}%` }}
          />
        );

        return onSelect ? (
          <button
            aria-label={s.title}
            aria-pressed={s.id === selectedId}
            className={classes}
            key={s.id}
            title={s.title}
            type="button"
            onClick={() => onSelect(s.id === selectedId ? null : s.id)}
          >
            {fill}
          </button>
        ) : (
          <span className={classes} key={s.id} title={s.title}>
            {fill}
          </span>
        );
      })}
    </div>
  );
}

/** The hatch a restoring segment uses, for a legend beside the reset line. */
export function PooledUsageHatch({ tone = "accent" }: { tone?: UsageTone }) {
  return (
    <span
      aria-hidden
      className={[styles.swatch, styles.restoring, TONES[tone]].join(" ")}
    />
  );
}
