import styles from "./EmptyStateIllustration.module.css";

export type EmptyStateVariant = "offline" | "success" | "welcome";

export interface EmptyStateIllustrationProps {
  variant: EmptyStateVariant;
  size?: number;
}

export function EmptyStateIllustration({
  variant,
  size = 120,
}: EmptyStateIllustrationProps) {
  return (
    <div className={styles.wrap} style={{ width: size, height: size }}>
      {variant === "welcome" ? <Welcome /> : null}
      {variant === "success" ? <Success /> : null}
      {variant === "offline" ? <Offline /> : null}
    </div>
  );
}

function Welcome() {
  return (
    <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="60" cy="60" r="55" fill="url(#glow)" />
      <circle
        cx="60"
        cy="60"
        r="22"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.5"
      />
      <circle cx="60" cy="60" r="6" fill="var(--accent)" />
      <circle
        cx="60"
        cy="60"
        r="40"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1"
        strokeDasharray="3 5"
        opacity="0.5"
      />
    </svg>
  );
}

function Success() {
  return (
    <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
      <circle
        cx="60"
        cy="60"
        r="42"
        fill="none"
        stroke="var(--success)"
        strokeWidth="2"
      />
      <path
        d="M44 62 L56 74 L78 50"
        stroke="var(--success)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function Offline() {
  return (
    <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
      <circle
        cx="60"
        cy="60"
        r="40"
        fill="none"
        stroke="var(--text-muted)"
        strokeWidth="1.5"
        opacity="0.5"
      />
      <path
        d="M40 40 L80 80 M80 40 L40 80"
        stroke="var(--warning)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
