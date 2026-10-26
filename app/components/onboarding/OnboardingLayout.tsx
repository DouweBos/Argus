import type { OnboardingStep } from "../../lib/types";
import type { ReactNode } from "react";
import { Button, Stepper } from "@argus/peacock";
import { useOnboarding } from "../../hooks/useOnboarding";
import {
  ONBOARDING_STEPS_ORDER,
  previousStepOf,
} from "../../stores/onboardingStore";
import styles from "./OnboardingLayout.module.css";

const STEP_LABELS: Record<OnboardingStep, string> = {
  welcome: "Welcome",
  telemetry: "Privacy",
  projects: "Projects",
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
  const { advance } = useOnboarding();
  const currentIndex = ONBOARDING_STEPS_ORDER.indexOf(currentStep);
  const steps = ONBOARDING_STEPS_ORDER.map((id) => ({
    id,
    label: STEP_LABELS[id],
  }));
  const canGoBack =
    currentStep !== "welcome" && previousStepOf(currentStep) !== currentStep;
  const backButton = canGoBack ? (
    <Button
      variant="ghost"
      onClick={() => {
        advance(previousStepOf(currentStep)).catch(() => {});
      }}
    >
      Back
    </Button>
  ) : null;
  const hasFooter = Boolean(backButton || footerLeft || footerRight);

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
          {hasFooter && (
            <div className={styles.footer}>
              <div className={styles.footerLeft}>
                {backButton}
                {footerLeft}
              </div>
              <div className={styles.footerRight}>{footerRight}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
