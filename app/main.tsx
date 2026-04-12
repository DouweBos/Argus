import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import {
  initAppQuitSave,
  initExternalAgentStarted,
} from "./lib/agentEventService";
import { vscodeReady } from "./lib/vscodeSetup";

// Save active conversations when the app is about to quit.
initAppQuitSave();
// Register agents spawned outside the UI (e.g. via MCP spawn_agent).
initExternalAgentStarted();

// VS Code services must be initialized before any editor component renders
vscodeReady.then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
