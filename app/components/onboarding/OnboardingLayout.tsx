import type { OnboardingStep } from "../../lib/types";
import type { ReactNode } from "react";
import { Stepper } from "@argus/peacock";
import { ONBOARDING_STEPS_ORDER } from "../../stores/onboardingStore";
import styles from "./OnboardingLayout.module.css";

const STEP_LABELS: Record<OnboardingStep, string> = {
  welcome: "Welcome",
  permissions: "Permissions",
  preflight: "Preflight",
  claude_auth: "Claude",
  defaults: "Defaults",
  launcher: "Launcher",
  telemetry: "Telemetry",
  completion: "Done",
};

export interface OnboardingLayoutProps {
  children: ReactNode;
  currentStep: OnboardingStep;
  footerLeft?: ReactNode;
  footerRight?: ReactNode;
  hero?: ReactNode;
  showStepper?: boolean;
  subtitle?: ReactNode;
  title: string;
}

export function OnboardingLayout({
  currentStep,
  title,
  subtitle,
  hero,
  footerLeft,
  footerRight,
  showStepper = true,
  children,
}: OnboardingLayoutProps) {
  const currentIndex = ONBOARDING_STEPS_ORDER.indexOf(currentStep);
  const steps = ONBOARDING_STEPS_ORDER.map((id) => ({
    id,
    label: STEP_LABELS[id],
  }));

  return (
    <div className={styles.root}>
      <div className={styles.dragRegion} />
      {showStepper ? (
        <div className={styles.header}>
          <Stepper steps={steps} currentIndex={currentIndex} />
        </div>
      ) : null}
      <div className={styles.content}>
        <div className={styles.panel}>
          {hero ? <div className={styles.hero}>{hero}</div> : null}
          <div>
            <h1 className={styles.title}>{title}</h1>
            {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
          </div>
          <div className={styles.body}>{children}</div>
          {(footerLeft || footerRight) && (
            <div className={styles.footer}>
              <div className={styles.footerLeft}>{footerLeft}</div>
              <div className={styles.footerRight}>{footerRight}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
