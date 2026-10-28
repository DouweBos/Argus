import styles from "./IssueStatusIcon.module.css";

/** Linear's fixed workflow categories. */
export type IssueStatusType =
  | "backlog"
  | "canceled"
  | "completed"
  | "duplicate"
  | "started"
  | "triage"
  | "unstarted";

export interface IssueStatusIconProps {
  className?: string;
  size?: number;
  /** Anything Linear adds later renders as unstarted. */
  type: string;
}

const KNOWN = new Set<IssueStatusType>([
  "backlog",
  "canceled",
  "completed",
  "duplicate",
  "started",
  "triage",
  "unstarted",
]);

/** The circle Linear draws for a status: dashed, empty, half, checked or crossed. */
export function IssueStatusIcon({
  className,
  size = 14,
  type,
}: IssueStatusIconProps) {
  const kind = KNOWN.has(type as IssueStatusType)
    ? (type as IssueStatusType)
    : "unstarted";
  const cls = [styles.icon, styles[kind], className].filter(Boolean).join(" ");

  return (
    <svg
      aria-hidden="true"
      className={cls}
      height={size}
      viewBox="0 0 14 14"
      width={size}
    >
      {kind === "backlog" && (
        <circle
          cx="7"
          cy="7"
          fill="none"
          r="5.5"
          stroke="currentColor"
          strokeDasharray="2 1.6"
          strokeWidth="1.5"
        />
      )}
      {(kind === "unstarted" || kind === "triage") && (
        <circle
          cx="7"
          cy="7"
          fill="none"
          r="5.5"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      )}
      {kind === "started" && (
        <>
          <circle
            cx="7"
            cy="7"
            fill="none"
            r="5.5"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path d="M7 3.5a3.5 3.5 0 0 1 0 7Z" fill="currentColor" />
        </>
      )}
      {kind === "completed" && (
        <>
          <circle cx="7" cy="7" fill="currentColor" r="6.25" />
          <path
            d="m4.4 7.1 1.8 1.8 3.5-3.6"
            fill="none"
            stroke="var(--bg-primary)"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
          />
        </>
      )}
      {(kind === "canceled" || kind === "duplicate") && (
        <>
          <circle cx="7" cy="7" fill="currentColor" r="6.25" />
          <path
            d="m5 5 4 4M9 5 5 9"
            fill="none"
            stroke="var(--bg-primary)"
            strokeLinecap="round"
            strokeWidth="1.5"
          />
        </>
      )}
    </svg>
  );
}
