import { useOnboarding } from "../../hooks/useOnboarding";
import { ClaudeAuthStep } from "./ClaudeAuthStep";
import { CompletionStep } from "./CompletionStep";
import { DefaultsFormStep } from "./DefaultsFormStep";
import { PermissionsStep } from "./PermissionsStep";
import { PreflightStep } from "./PreflightStep";
import { WelcomeStep } from "./WelcomeStep";

export function OnboardingRoot() {
  const { currentStep, loading } = useOnboarding();

  if (loading) {
    return null;
  }

  switch (currentStep) {
    case "welcome":
      return <WelcomeStep />;
    case "permissions":
      return <PermissionsStep />;
    case "preflight":
      return <PreflightStep />;
    case "claude_auth":
      return <ClaudeAuthStep />;
    case "defaults":
      return <DefaultsFormStep />;
    case "completion":
      return <CompletionStep />;
    default:
      return <WelcomeStep />;
  }
}
