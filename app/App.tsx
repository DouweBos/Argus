import "./styles/global.css";
import "./lib/logService"; // Start collecting backend logs immediately on boot.
import { AppShell } from "./components/layout/AppShell";

export default function App() {
  return <AppShell />;
}
