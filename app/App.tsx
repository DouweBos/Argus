import "./styles/global.css";
import { AppShell } from "./components/layout/AppShell";
import { ImageViewer } from "./components/shared/ImageViewer/ImageViewer";

export default function App() {
  return (
    <>
      <AppShell />
      <ImageViewer />
    </>
  );
}
