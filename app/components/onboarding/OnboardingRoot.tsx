import { useOnboarding } from "../../hooks/useOnboarding";
import { ArgusConfigStep } from "./ArgusConfigStep";
import { ClaudeAuthStep } from "./ClaudeAuthStep";
import { CompletionStep } from "./CompletionStep";
import { DefaultsFormStep } from "./DefaultsFormStep";
import { FirstAgentStep } from "./FirstAgentStep";
import { FirstSessionStep } from "./FirstSessionStep";
import { PermissionsStep } from "./PermissionsStep";
import { PreflightStep } from "./PreflightStep";
import { ProjectPickerStep } from "./ProjectPickerStep";
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
    case "project":
      return <ProjectPickerStep />;
    case "argus_config":
      return <ArgusConfigStep />;
    case "first_session":
      return <FirstSessionStep />;
    case "first_agent":
      return <FirstAgentStep />;
    case "completion":
      return <CompletionStep />;
    default:
      return <WelcomeStep />;
  }
}
