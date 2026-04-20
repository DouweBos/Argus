import "./styles/global.css";
import { AppShell } from "./components/layout/AppShell";
import { QuitGuard } from "./components/shared/ConfirmStopAgent/QuitGuard";
import { StopAgentGuard } from "./components/shared/ConfirmStopAgent/stopAgentGuard";
import { ImageViewer } from "./components/shared/ImageViewer/ImageViewer";

export default function App() {
  return (
    <>
      <AppShell />
      <ImageViewer />
      <StopAgentGuard />
      <QuitGuard />
    </>
  );
}
