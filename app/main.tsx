import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initActivityService } from "./lib/activityService";
import {
  initAppQuitSave,
  initExternalAgentStarted,
} from "./lib/agentEventService";
import { initReviewQueueListener } from "./lib/reviewQueueService";
import { vscodeReady } from "./lib/vscodeSetup";
import { initConductorLogListener } from "./stores/conductorLogStore";
import { initDevicePolling } from "./stores/deviceStore";

// Save active conversations when the app is about to quit.
initAppQuitSave();
// Register agents spawned outside the UI (e.g. via MCP spawn_agent).
initExternalAgentStarted();
// Append every conductor call to the per-device live log.
initConductorLogListener();
// Poll the device list so the sidebar count updates even before the
// Devices screen has been opened.
initDevicePolling();
// Maintain the Review queue from backend `workspace:review-state` events.
initReviewQueueListener();
// Subscribe to agent/workspace/commit/device signals and populate Activity.
initActivityService();

// VS Code services must be initialized before any editor component renders
vscodeReady.then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
