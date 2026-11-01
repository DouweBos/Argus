import "@argus/peacock/tokens.css";
import "../app.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initTheme } from "../lib/theme";
import { installHostSync } from "../stores/hostSync";
import { provideAccountFields } from "../ui/accountFields";
import { NameField, SignOutField } from "./AccountFields";
import { HostedApp } from "./HostedApp";

initTheme();
installHostSync();
provideAccountFields({ Name: NameField, SignOut: SignOutField });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HostedApp />
  </StrictMode>,
);
