import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/global.css";
import { AgentPopout } from "./components/popout/AgentPopout";
import { SimulatorPopout } from "./components/popout/SimulatorPopout";
import { seedPopoutStore } from "./components/popout/seedPopoutStore";
import {
  initAppQuitSave,
  initExternalAgentStarted,
} from "./lib/agentEventService";
import { initAgentPopoutSync } from "./lib/agentPopoutService";
import { initNotificationsListener } from "./lib/notificationsService";
import { initPendingSessionPrompts } from "./lib/pendingSessionPrompts";
import { initReviewQueueListener } from "./lib/reviewQueueService";
import { vscodeReady } from "./lib/vscodeSetup";
import { initConductorLogListener } from "./stores/conductorLogStore";
import { initDevicePolling } from "./stores/deviceStore";
import { initTheme } from "./stores/themeStore";

// Apply theme before first paint so there is no flash of the wrong theme.
initTheme();

const params = new URLSearchParams(window.location.search);
const popoutMode = params.get("popout");

if (popoutMode === "agent") {
  // Minimal popout renderer for a single detached agent. Hydration happens
  // inside the component so we can show a loading state while the session +
  // agent are fetched from the backend.
  const agentId = params.get("agentId") ?? "";
  const sessionId = params.get("sessionId") ?? "";
  const title = params.get("title") ?? undefined;

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <AgentPopout agentId={agentId} sessionId={sessionId} title={title} />
    </React.StrictMode>,
  );
} else if (popoutMode === "simulator") {
  // Minimal popout renderer — bypasses the heavy VS Code / quit wiring so
  // this separate BrowserWindow stays lightweight.
  const udid = params.get("udid") ?? "";
  const portRaw = params.get("port");
  const port = portRaw ? Number.parseInt(portRaw, 10) : NaN;
  const name = params.get("name") ?? "Simulator";
  const runtime = params.get("runtime") ?? "";
  const booted = params.get("booted") === "1";

  seedPopoutStore({
    udid,
    deviceName: name,
    mjpegPort: Number.isFinite(port) ? port : null,
    runtime,
    booted,
  });

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <SimulatorPopout />
    </React.StrictMode>,
  );
} else {
  // Save active conversations when the app is about to quit.
  initAppQuitSave();
  // Register agents spawned outside the UI (e.g. via MCP spawn_agent).
  initExternalAgentStarted();
  // Append every conductor call to the per-device live log.
  initConductorLogListener();
  // Poll the device list so the sidebar count updates even before the
  // Devices screen has been opened.
  initDevicePolling();
  // Maintain the Review queue from backend `session:review-state` events.
  initReviewQueueListener();
  // Surface backend `notification` events (e.g. failed title generation)
  // as user-visible toasts in the notifications panel.
  initNotificationsListener();
  // Dispatch captured initial prompts once their session's worktree is ready.
  initPendingSessionPrompts();
  // Keep the poppedOut-agents set in sync with the backend so every window's
  // tab bar hides agents that are currently detached.
  initAgentPopoutSync();

  // VS Code services must be initialized before any editor component renders
  vscodeReady.then(() => {
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  });
}
