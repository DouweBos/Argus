import { useEffect, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import "./styles/global.css";
import { AppShell } from "./components/layout/AppShell";
import { NavigationDeepLinkBridge } from "./components/layout/NavigationDeepLinkBridge";
import { QuitGuard } from "./components/shared/ConfirmStopAgent/QuitGuard";
import { StopAgentGuard } from "./components/shared/ConfirmStopAgent/stopAgentGuard";
import { ImageViewer } from "./components/shared/ImageViewer/ImageViewer";
import { getPersistedRoute } from "./lib/routePersistence";
import { useRegisterNavigator, useRouteSync } from "./lib/router";

function RouterGlue() {
  useRegisterNavigator();
  useRouteSync();

  return <NavigationDeepLinkBridge />;
}

export default function App() {
  const [initialPath, setInitialPath] = useState<string | null>(null);

  useEffect(() => {
    getPersistedRoute()
      .then((p) => setInitialPath(p ?? "/"))
      .catch(() => setInitialPath("/"));
  }, []);

  if (initialPath === null) {
    return null;
  }

  return (
    <MemoryRouter initialEntries={[initialPath]}>
      <RouterGlue />
      <AppShell />
      <ImageViewer />
      <StopAgentGuard />
      <QuitGuard />
    </MemoryRouter>
  );
}
