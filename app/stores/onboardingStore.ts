import type {
  OnboardingConfigFile,
  OnboardingStep,
  PrereqId,
  PrereqResult,
} from "../lib/types";
import { create } from "zustand";
import { ONBOARDING_STEPS } from "../lib/types";

export const ONBOARDING_STEPS_ORDER: readonly OnboardingStep[] =
  ONBOARDING_STEPS;

export function nextStepAfter(step: OnboardingStep): OnboardingStep {
  const idx = ONBOARDING_STEPS_ORDER.indexOf(step);

  return ONBOARDING_STEPS_ORDER[
    Math.min(idx + 1, ONBOARDING_STEPS_ORDER.length - 1)
  ];
}

export function previousStepOf(step: OnboardingStep): OnboardingStep {
  const idx = ONBOARDING_STEPS_ORDER.indexOf(step);

  return ONBOARDING_STEPS_ORDER[Math.max(idx - 1, 0)];
}

interface OnboardingStoreData {
  config: OnboardingConfigFile | null;
  currentStep: OnboardingStep;
  loading: boolean;
  /** Map of prereq id → most recent result (incl. running). */
  prereqs: Record<string, PrereqResult>;
  /** Selected project root (set during project step). */
  projectPath: string | null;
}

export const onboardingStore = create<OnboardingStoreData>(() => ({
  config: null,
  currentStep: "welcome",
  loading: true,
  projectPath: null,
  prereqs: {},
}));

export const useOnboardingStore = onboardingStore;

export function setOnboardingConfig(config: OnboardingConfigFile): void {
  onboardingStore.setState({
    config,
    currentStep: config.onboarding.lastStep,
    loading: false,
  });
}

export function setCurrentStep(step: OnboardingStep): void {
  onboardingStore.setState({ currentStep: step });
}

export function setProjectPath(path: string | null): void {
  onboardingStore.setState({ projectPath: path });
}

export function setPrereq(result: PrereqResult): void {
  onboardingStore.setState((s) => ({
    prereqs: { ...s.prereqs, [result.id]: result },
  }));
}

export function setPrereqs(results: PrereqResult[]): void {
  onboardingStore.setState((s) => {
    const next = { ...s.prereqs };
    results.forEach((r) => {
      next[r.id] = r;
    });

    return { prereqs: next };
  });
}

export function clearPrereq(id: PrereqId): void {
  onboardingStore.setState((s) => {
    const next = { ...s.prereqs };
    delete next[id];

    return { prereqs: next };
  });
}
