import { useEffect } from "react";
import { MemoryRouter } from "react-router-dom";
import { DragLayer } from "@argus/peacock";
import { AppShell } from "./components/layout/AppShell";
import { NavigationDeepLinkBridge } from "./components/layout/NavigationDeepLinkBridge";
import { OnboardingRoot } from "./components/onboarding/OnboardingRoot";
import { AccountLinkPrompt } from "./components/shared/AccountLinkPrompt/AccountLinkPrompt";
import { QuitGuard } from "./components/shared/ConfirmStopAgent/QuitGuard";
import { StopAgentGuard } from "./components/shared/ConfirmStopAgent/stopAgentGuard";
import { DiagramViewer } from "./components/shared/DiagramViewer/DiagramViewer";
import { ImageViewer } from "./components/shared/ImageViewer/ImageViewer";
import { UpdaterHost } from "./components/shared/Updater/UpdaterHost";
import { useHandoffActivity } from "./hooks/useHandoffActivity";
import { useOnboarding } from "./hooks/useOnboarding";
import { useTabRouteSync } from "./hooks/useTabRouteSync";
import { applyLaunchRoute } from "./lib/launchRoute";
import { useRegisterNavigator } from "./lib/router";

function RouterGlue() {
  useRegisterNavigator();
  useTabRouteSync();
  useHandoffActivity();
  // After the tab restore above, so a saved route always wins over the
  // preference.
  useEffect(() => {
    applyLaunchRoute().catch(() => undefined);
  }, []);

  return <NavigationDeepLinkBridge />;
}

export default function App() {
  const { config, loading } = useOnboarding();

  if (loading) {
    return null;
  }

  const completed = config?.onboarding.completed ?? false;

  if (!completed) {
    return (
      <>
        <OnboardingRoot />
        <UpdaterHost />
      </>
    );
  }

  return (
    <MemoryRouter initialEntries={["/"]}>
      <RouterGlue />
      <AppShell />
      <ImageViewer />
      <DiagramViewer />
      <StopAgentGuard />
      <QuitGuard />
      <AccountLinkPrompt />
      <UpdaterHost />
      <DragLayer />
    </MemoryRouter>
  );
}
