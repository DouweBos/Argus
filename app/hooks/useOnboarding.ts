import type { OnboardingStep } from "../lib/types";
import { useCallback, useEffect } from "react";
import { error as logError } from "@logger";
import {
  completeOnboarding,
  getOnboardingState,
  setOnboardingLastStep,
} from "../lib/ipc";
import {
  ONBOARDING_STEPS_ORDER,
  onboardingStore,
  setCurrentStep,
  setOnboardingConfig,
  useOnboardingStore,
} from "../stores/onboardingStore";

export function useOnboarding() {
  const state = useOnboardingStore();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await getOnboardingState();
        if (!cancelled) {
          setOnboardingConfig(cfg);
        }
      } catch (err) {
        logError("Failed to load onboarding state", err);
        if (!cancelled) {
          onboardingStore.setState({ loading: false });
        }
      }
    })().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  const advance = useCallback(async (nextStep: OnboardingStep) => {
    setCurrentStep(nextStep);
    try {
      await setOnboardingLastStep(nextStep);
    } catch (err) {
      logError("Failed to persist lastStep", err);
    }
  }, []);

  const complete = useCallback(async () => {
    try {
      await completeOnboarding();
    } catch (err) {
      logError("Failed to mark onboarding complete", err);
    }
    onboardingStore.setState((s) =>
      s.config
        ? {
            config: {
              ...s.config,
              onboarding: {
                ...s.config.onboarding,
                completed: true,
                completedAt: Date.now(),
              },
            },
          }
        : {},
    );
  }, []);

  return {
    ...state,
    advance,
    complete,
  };
}

export { ONBOARDING_STEPS_ORDER };
