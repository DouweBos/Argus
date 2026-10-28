import "@argus/peacock/tokens.css";
import "../app.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initTheme } from "../lib/theme";
import { HostedApp } from "./HostedApp";

initTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HostedApp />
  </StrictMode>,
);
