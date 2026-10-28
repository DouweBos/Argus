import styles from "./PriorityIcon.module.css";

export interface PriorityIconProps {
  className?: string;
  /** Linear's 0–4: 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
  priority: number;
  size?: number;
}

export const PRIORITY_LABELS: Record<number, string> = {
  0: "No priority",
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
};

/** Signal bars for high to low, a filled alert for urgent, dashes for none. */
export function PriorityIcon({
  className,
  priority,
  size = 14,
}: PriorityIconProps) {
  const cls = [styles.icon, priority === 1 && styles.urgent, className]
    .filter(Boolean)
    .join(" ");
  // High lights all three bars, medium two, low one.
  const lit = priority >= 2 && priority <= 4 ? 5 - priority : 0;

  return (
    <svg
      aria-label={PRIORITY_LABELS[priority] ?? PRIORITY_LABELS[0]}
      className={cls}
      height={size}
      role="img"
      viewBox="0 0 14 14"
      width={size}
    >
      {priority === 1 && (
        <>
          <rect fill="currentColor" height="12" rx="3" width="12" x="1" y="1" />
          <path
            d="M7 3.8v4M7 10.2v.01"
            stroke="var(--bg-primary)"
            strokeLinecap="round"
            strokeWidth="1.7"
          />
        </>
      )}
      {priority === 0 &&
        [2, 6, 10].map((x) => (
          <rect
            key={x}
            fill="currentColor"
            height="1.5"
            rx="0.75"
            width="2.5"
            x={x}
            y="6.25"
          />
        ))}
      {lit > 0 &&
        [0, 1, 2].map((i) => (
          <rect
            key={i}
            className={i < lit ? undefined : styles.dim}
            fill="currentColor"
            height={4 + i * 3}
            rx="1"
            width="3"
            x={1.5 + i * 4}
            y={11 - i * 3}
          />
        ))}
    </svg>
  );
}
