import type { RunnerOnboardingStep } from "../../lib/types";
import { useEffect, useState } from "react";
import { error as logError } from "@logger";
import { useOnboarding } from "../../hooks/useOnboarding";
import { listRunnerOnboardingSteps } from "../../lib/ipc";
import { CompletionStep } from "./CompletionStep";
import { LauncherStep } from "./LauncherStep";
import { PermissionsStep } from "./PermissionsStep";
import { PreflightStep } from "./PreflightStep";
import { TelemetryStep } from "./TelemetryStep";
import { WelcomeStep } from "./WelcomeStep";
import { runnerOnboardingComponents } from "./runnerSteps";

function useRunnerOnboardingSteps(): RunnerOnboardingStep[] {
  const [steps, setSteps] = useState<RunnerOnboardingStep[]>([]);
  useEffect(() => {
    let cancelled = false;
    listRunnerOnboardingSteps()
      .then((next) => {
        if (!cancelled) {
          setSteps(next);
        }
      })
      .catch((err) => {
        logError("Failed to load runner onboarding steps", err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return steps;
}

export function OnboardingRoot() {
  const { currentStep, loading } = useOnboarding();
  const runnerSteps = useRunnerOnboardingSteps();

  if (loading) {
    return null;
  }

  const runnerMatch = runnerSteps.find((s) => s.id === currentStep);
  if (runnerMatch) {
    const Component = runnerOnboardingComponents[runnerMatch.kind];
    if (Component) {
      return <Component />;
    }
    logError(
      `No renderer registered for runner onboarding step kind=${runnerMatch.kind}`,
    );
  }

  switch (currentStep) {
    case "welcome":
      return <WelcomeStep />;
    case "permissions":
      return <PermissionsStep />;
    case "preflight":
      return <PreflightStep />;
    case "launcher":
      return <LauncherStep />;
    case "telemetry":
      return <TelemetryStep />;
    case "completion":
      return <CompletionStep />;
    default:
      return <WelcomeStep />;
  }
}
