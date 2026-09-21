import styles from "./ConfidenceMeter.module.css";

export type ConfidenceBand = "high" | "low" | "medium";

const SEGMENTS = 5;

/**
 * Coarse band for a 0..1 confidence. Deliberately three buckets: the number is
 * self-reported, so anything finer would imply precision it does not have.
 */
export function confidenceBand(value: number): ConfidenceBand {
  const clamped = Math.min(1, Math.max(0, value));
  if (clamped >= 0.8) {
    return "high";
  }

  return clamped >= 0.5 ? "medium" : "low";
}

export const CONFIDENCE_BAND_LABELS: Record<ConfidenceBand, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

export interface ConfidenceMeterProps {
  /** Hide the band wording and keep the bar only. */
  compact?: boolean;
  /** 0..1, self-reported. Values outside the range are clamped. */
  value: number;
}

/**
 * Self-reported confidence, rendered as five filled segments plus a band
 * word. Never a percentage — the source is a model's own guess, and "87%"
 * reads as a measurement.
 */
export function ConfidenceMeter({ compact, value }: ConfidenceMeterProps) {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  const filled =
    clamped === 0 ? 0 : Math.max(1, Math.round(clamped * SEGMENTS));
  const band = confidenceBand(clamped);

  return (
    <span
      aria-label={`${CONFIDENCE_BAND_LABELS[band]}, self-reported`}
      className={styles.wrap}
      title="Confidence the automation reported for itself — not a measured probability."
    >
      <span aria-hidden className={styles.bar}>
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span
            className={[
              styles.segment,
              i < filled ? styles[band] : styles.empty,
            ]
              .filter(Boolean)
              .join(" ")}
            key={i}
          />
        ))}
      </span>
      {!compact && (
        <span className={styles.label}>{CONFIDENCE_BAND_LABELS[band]}</span>
      )}
    </span>
  );
}
