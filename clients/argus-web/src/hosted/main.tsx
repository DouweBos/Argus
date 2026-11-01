import "@argus/peacock/tokens.css";
import "../app.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initTheme } from "../lib/theme";
import { installHostSync } from "../stores/hostSync";
import { HostedApp } from "./HostedApp";

initTheme();
installHostSync();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HostedApp />
  </StrictMode>,
);
