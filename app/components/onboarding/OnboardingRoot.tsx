import { useOnboarding } from "../../hooks/useOnboarding";
import { TelemetryStep } from "./TelemetryStep";
import { WelcomeStep } from "./WelcomeStep";

export function OnboardingRoot() {
  const { currentStep, loading } = useOnboarding();

  if (loading) {
    return null;
  }

  return currentStep === "telemetry" ? <TelemetryStep /> : <WelcomeStep />;
}
