import type { ComponentType } from "react";
import { ClaudeAuthStep } from "./ClaudeAuthStep";

/**
 * Renderer-side registry mapping a runner-onboarding step's `kind` to its
 * React component. Adding a new runner with its own auth UI is purely
 * additive: the runner contributes a {@link RunnerOnboardingStep} on the
 * electron side, and the matching component registers here.
 */
export const runnerOnboardingComponents: Record<string, ComponentType> = {
  "claude-auth": ClaudeAuthStep,
};
