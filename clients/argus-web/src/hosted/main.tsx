import "@argus/peacock/tokens.css";
import "../app.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initTheme } from "../lib/theme";
import { installHostSync } from "../stores/hostSync";
import { startTelemetry } from "../telemetry/telemetry";
import { provideAccountFields } from "../ui/accountFields";
import { NameField, SignOutField } from "./AccountFields";
import { HostedApp } from "./HostedApp";

initTheme();
installHostSync();
// Hosted computers are opened from the account, never paired here.
startTelemetry("hosted", false);
provideAccountFields({ Name: NameField, SignOut: SignOutField });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HostedApp />
  </StrictMode>,
);
