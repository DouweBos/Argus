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
import { getTelemetryInit, setTelemetryEnabledOnMain } from "./lib/ipc";
import { initNotificationsListener } from "./lib/notificationsService";
import { initPendingSessionPrompts } from "./lib/pendingSessionPrompts";
import { initPrewarm } from "./lib/prewarmService";
import { initReviewQueueListener } from "./lib/reviewQueueService";
import { initTelemetry, capture as telemetryCapture } from "./lib/telemetry";
import { initConductorLogListener } from "./stores/conductorLogStore";
import { initDevicePolling } from "./stores/deviceStore";
import { getTelemetryEnabled } from "./stores/settingsStore";
import { initTheme } from "./stores/themeStore";
import { initUiScale } from "./stores/uiScaleStore";

// Apply theme before first paint so there is no flash of the wrong theme.
initTheme();
initUiScale();

const params = new URLSearchParams(window.location.search);
const popoutMode = params.get("popout");

// Anonymous, opt-out telemetry. Boots once per renderer; popout windows
// share the same install id and respect the same enable flag.
async function bootTelemetry(): Promise<void> {
  try {
    const init = await getTelemetryInit();
    const userEnabled = getTelemetryEnabled();
    initTelemetry({
      distinctId: init.distinctId,
      enabled: userEnabled,
      appVersion: init.appVersion,
    });
    if (userEnabled !== init.enabled) {
      await setTelemetryEnabledOnMain(userEnabled);
    }
    if (userEnabled) {
      telemetryCapture("renderer_started", { popout: popoutMode ?? "main" });
    }
  } catch {
    // Telemetry must never block app startup.
  }
}

bootTelemetry().catch(() => undefined);

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
  // Eagerly spawn one Claude subprocess per ready session so dialogs have
  // real model + slash-command lists ahead of time and the user-facing
  // "send" path skips the spawn + initialize wait on first prompt.
  initPrewarm();
  // Keep the poppedOut-agents set in sync with the backend so every window's
  // tab bar hides agents that are currently detached.
  initAgentPopoutSync();

  // VS Code services must be initialized before any editor component renders.
  // Imported lazily so popout windows don't pay the cost — and, critically,
  // don't trigger the module-level IIFE that mounts the VS Code workbench
  // into `document.body`, which otherwise covers the popout's React tree and
  // leaves the floating simulator window blank-white.
  import("./lib/vscodeSetup").then(({ vscodeReady }) =>
    vscodeReady.then(() => {
      ReactDOM.createRoot(
        document.getElementById("root") as HTMLElement,
      ).render(
        <React.StrictMode>
          <App />
        </React.StrictMode>,
      );
    }),
  );
}
