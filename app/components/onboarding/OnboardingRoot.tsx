import { useOnboarding } from "../../hooks/useOnboarding";
import { ProjectsStep } from "./ProjectsStep";
import { TelemetryStep } from "./TelemetryStep";
import { WelcomeStep } from "./WelcomeStep";

export function OnboardingRoot() {
  const { currentStep, loading } = useOnboarding();

  if (loading) {
    return null;
  }

  if (currentStep === "projects") {
    return <ProjectsStep />;
  }

  return currentStep === "telemetry" ? <TelemetryStep /> : <WelcomeStep />;
}
