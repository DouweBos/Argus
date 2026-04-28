import { MemoryRouter } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { NavigationDeepLinkBridge } from "./components/layout/NavigationDeepLinkBridge";
import { OnboardingRoot } from "./components/onboarding/OnboardingRoot";
import { QuitGuard } from "./components/shared/ConfirmStopAgent/QuitGuard";
import { StopAgentGuard } from "./components/shared/ConfirmStopAgent/stopAgentGuard";
import { ImageViewer } from "./components/shared/ImageViewer/ImageViewer";
import { UpdaterHost } from "./components/shared/Updater/UpdaterHost";
import { useOnboarding } from "./hooks/useOnboarding";
import { useRegisterNavigator } from "./lib/router";

function RouterGlue() {
  useRegisterNavigator();

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
      <StopAgentGuard />
      <QuitGuard />
      <UpdaterHost />
    </MemoryRouter>
  );
}
