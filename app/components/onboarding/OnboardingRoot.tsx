import { useOnboarding } from "../../hooks/useOnboarding";
import { useColorThemeOverride } from "../../stores/colorThemeStore";
import { ProjectsStep } from "./ProjectsStep";
import { TelemetryStep } from "./TelemetryStep";
import { WelcomeStep } from "./WelcomeStep";

export function OnboardingRoot() {
  const { currentStep, loading } = useOnboarding();
  // First impressions are in Argus's own colors, whatever theme gets picked later.
  useColorThemeOverride("amber");

  if (loading) {
    return null;
  }

  if (currentStep === "projects") {
    return <ProjectsStep />;
  }

  return currentStep === "telemetry" ? <TelemetryStep /> : <WelcomeStep />;
}
