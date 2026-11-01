import "@argus/peacock/tokens.css";
import "@argus/peacock/fonts.css";
import "./app.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initTheme } from "./lib/theme";
import { installHostSync } from "./stores/hostSync";
import { App } from "./ui/App";

initTheme();
installHostSync();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
