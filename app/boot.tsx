/**
 * App boot — everything that touches backend state, split out of `main.tsx` so
 * it loads only after the transport is settled. Stores scope their caches by
 * the attached host, so nothing here may be imported before that decision.
 */

import type { Platform } from "./stores/simulatorStore";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AgentPopout } from "./components/popout/AgentPopout";
import { DevicePopout } from "./components/popout/DevicePopout";
import { PopoutRoot } from "./components/popout/PopoutRoot";
import { seedPopoutStore } from "./components/popout/seedPopoutStore";
import {
  initAppQuitSave,
  initExternalAgentStarted,
} from "./lib/agentEventService";
import { initAgentPopoutSync } from "./lib/agentPopoutService";
import { hydrateFromHost } from "./lib/hostHydration";
import { getTelemetryInit, setTelemetryModeOnMain } from "./lib/ipc";
import { initNotificationsListener } from "./lib/notificationsService";
import { initPendingSessionPrompts } from "./lib/pendingSessionPrompts";
import { initPrewarm } from "./lib/prewarmService";
import { bootstrapProjects } from "./lib/projectsService";
import { initPushNotificationsListener } from "./lib/pushNotificationsService";
import { initRepoBranchSync } from "./lib/repoBranchSync";
import { initSessionEventListeners } from "./lib/sessionEventListeners";
import { initTelemetry, capture as telemetryCapture } from "./lib/telemetry";
import { isRemoteMode } from "./lib/transport";
import { initConductorLogListener } from "./stores/conductorLogStore";
import { initDevicePolling } from "./stores/deviceStore";
import { getTelemetryMode } from "./stores/settingsStore";

export function boot(popoutMode: string | null, params: URLSearchParams): void {
  // Anonymous, opt-out telemetry. Boots once per renderer; popout windows
  // share the same install id and respect the same enable flag.
  async function bootTelemetry(): Promise<void> {
    try {
      const init = await getTelemetryInit();
      const userMode = getTelemetryMode();
      initTelemetry({
        configured: init.configured,
        mode: userMode,
        popout: popoutMode ?? "main",
      });
      if (userMode !== init.mode) {
        // Push the persisted user choice to main — this is what triggers the
        // once-per-launch heartbeat (and, for `full`, `app_launched`).
        await setTelemetryModeOnMain(userMode);
      }
      if (userMode === "full") {
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
        <PopoutRoot initialPath={`/sessions/${sessionId}`}>
          <AgentPopout agentId={agentId} sessionId={sessionId} title={title} />
        </PopoutRoot>
      </React.StrictMode>,
    );
  } else if (popoutMode === "device") {
    // Minimal popout renderer — bypasses the heavy VS Code / quit wiring so
    // this separate BrowserWindow stays lightweight.
    seedPopoutStore({
      platform: (params.get("platform") ?? "ios") as Platform,
      deviceKey: params.get("deviceKey") ?? "",
      deviceName: params.get("name") ?? "Device",
      runtime: params.get("runtime") ?? "",
      online: params.get("online") === "1",
      capturing: params.get("capturing") === "1",
    });

    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <PopoutRoot>
          <DevicePopout />
        </PopoutRoot>
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
    // Subscribe to project/session lifecycle events once for the whole app —
    // components no longer install their own listeners on mount.
    initSessionEventListeners();
    // Refetch the repo branch whenever the project_root session's git state
    // changes — replaces per-component getRepoBranch polls.
    initRepoBranchSync();
    // Hydrate projects exactly once. Attached to a host, the list comes from
    // the host's registered roots — this Mac's recent paths are a different
    // disk. Lives outside React so StrictMode / HMR can't re-trigger it.
    const hydrate = isRemoteMode() ? hydrateFromHost() : bootstrapProjects();
    hydrate.catch(() => undefined);
    // Surface backend `notification` events (e.g. failed title generation)
    // as user-visible toasts in the notifications panel.
    initNotificationsListener();
    // Focus the right agent when the user clicks a native push notification
    // sent by the MCP `push_notification` tool.
    initPushNotificationsListener();
    // Dispatch captured initial prompts once their session's worktree is ready.
    initPendingSessionPrompts();
    // Keep at most one Claude subprocess warmed up — for the currently
    // selected, agent-less session — so its StartAgentDialog gets real
    // model + slash-command lists ahead of time and the first send skips
    // the spawn + initialize wait.
    initPrewarm();
    // Keep the poppedOut-agents set in sync with the backend so every window's
    // tab bar hides agents that are currently detached.
    initAgentPopoutSync();

    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  }
}
