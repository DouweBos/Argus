import type { ReactNode } from "react";
import { Icons, Stepper } from "@argus/peacock";

/** The three things a browser does before it reaches a computer. */
const ONBOARDING_STEPS = [
  { id: "signIn", label: "Sign in" },
  { id: "approve", label: "Approve" },
  { id: "open", label: "Connect" },
];

/** The single-column page every hosted screen before the monitor sits in. */
export function HostedFrame({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="aw-shell aw-hosted">
      <header className="aw-hero">
        <Icons.ArgusLogo size={24} />
        <h1 className="aw-title">{title}</h1>
        {actions && <div className="aw-hosted-actions">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

/** The centred onboarding page: brand, where this browser is in joining, then the step itself. */
export function HostedAuthFrame({
  title,
  subtitle,
  step,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  /** Index into the onboarding steps; omitted while there's nothing to place yet. */
  step?: number;
  children: ReactNode;
}) {
  return (
    <div className="aw-auth">
      <div className="aw-auth-glow" aria-hidden />
      <main className="aw-auth-column">
        <header className="aw-auth-hero">
          <Icons.ArgusLogo size={72} className="aw-auth-logo" />
          <h1 className="aw-auth-title">{title}</h1>
          {subtitle && <p className="aw-auth-subtitle">{subtitle}</p>}
        </header>
        {step !== undefined && (
          <Stepper
            className="aw-auth-steps"
            steps={ONBOARDING_STEPS}
            currentIndex={step}
            aria-label="Getting this browser onto your account"
          />
        )}
        {children}
        <p className="aw-auth-footnote">
          Computers reach this browser through their own tunnel, end-to-end
          encrypted.
        </p>
      </main>
    </div>
  );
}
