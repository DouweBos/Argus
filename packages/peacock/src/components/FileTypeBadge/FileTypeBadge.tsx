export interface FileTypeBadgeProps {
  /** Short label shown inside the file outline (usually the extension). */
  label: string;
  /** Stroke + text color. */
  color: string;
  size?: number;
  className?: string;
}

/**
 * File outline with a short extension label — a visual primitive used by file
 * lists, diff summaries, and change stats.
 */
export function FileTypeBadge({
  label,
  color,
  size = 14,
  className,
}: FileTypeBadgeProps) {
  return (
    <svg className={className} height={size} viewBox="0 0 16 16" width={size}>
      <path
        d="M3 1.5h6.5L13 5v9.5H3z"
        fill="none"
        opacity="0.5"
        stroke={color}
        strokeWidth="1"
      />
      <path
        d="M9.5 1.5V5H13"
        fill="none"
        opacity="0.5"
        stroke={color}
        strokeWidth="1"
      />
      <text
        fill={color}
        fontFamily="var(--font-ui)"
        fontSize="6"
        fontWeight="700"
        textAnchor="middle"
        x="8"
        y="12"
      >
        {label}
      </text>
    </svg>
  );
}
