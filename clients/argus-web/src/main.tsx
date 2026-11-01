import "@argus/peacock/tokens.css";
import "@argus/peacock/fonts.css";
import "./app.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initTheme } from "./lib/theme";
import { loadIdentity } from "./lib/keystore";
import { installHostSync } from "./stores/hostSync";
import { startTelemetry } from "./telemetry/telemetry";
import { App } from "./ui/App";

initTheme();
installHostSync();
startTelemetry("network", loadIdentity() !== null);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
