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
import { initExternalAgentStarted } from "./lib/agentEventService";
import { initAgentPopoutSync } from "./lib/agentPopoutService";
import { hostPrefsImportedCount } from "./lib/hostPrefs";
import { initHuddleDeviceMirror } from "./lib/huddleDeviceMirror";
import { getTelemetryInit, setTelemetryModeOnMain } from "./lib/ipc";
import { initNotificationsListener } from "./lib/notificationsService";
import { initPendingSessionPrompts } from "./lib/pendingSessionPrompts";
import { bootstrapProjects } from "./lib/projectsService";
import { initPushNotificationsListener } from "./lib/pushNotificationsService";
import { initSessionEventListeners } from "./lib/sessionEventListeners";
import { initTelemetry, capture as telemetryCapture } from "./lib/telemetry";
import { initViewingHint } from "./lib/viewingHint";
import { initConductorLogListener } from "./stores/conductorLogStore";
import { initDevicePolling } from "./stores/deviceStore";
import { initHuddleRooms } from "./stores/huddleStore";
import { getTelemetryMode } from "./stores/settingsStore";

export function boot(popoutMode: string | null, params: URLSearchParams): void {
  // Anonymous telemetry. Boots once per renderer; popout windows share the
  // same install id and respect the same mode.
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
        // Push the persisted user choice to main — for `full` this is what
        // records `app_launched`.
        await setTelemetryModeOnMain(userMode);
      }
      if (userMode === "full") {
        telemetryCapture("renderer_started", { popout: popoutMode ?? "main" });
      }
      const imported = hostPrefsImportedCount();
      if (imported > 0) {
        telemetryCapture("prefs_imported", { keys: imported });
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
    // Register agents spawned outside the UI (e.g. via MCP spawn_agent).
    initExternalAgentStarted();
    // Append every conductor call to the per-device live log.
    initConductorLogListener();
    // Poll the device list so the sidebar count updates even before the
    // Devices screen has been opened.
    initDevicePolling();
    // Mirror live huddle rooms so the share button and join prompts are
    // driven by the host's broadcast rather than by polling.
    initHuddleRooms();
    // Keep every live huddle pointed at the device its session has open — a
    // simulator started mid-share has to reach the guests too.
    initHuddleDeviceMirror();
    // Subscribe to project/session lifecycle events once for the whole app —
    // components no longer install their own listeners on mount.
    initSessionEventListeners();
    // Refetch the repo branch whenever the project_root session's git state
    // changes — replaces per-component getRepoBranch polls.
    // Hydrate this Mac's projects exactly once. Attached hosts bring their own
    // in as they connect — their registered roots are paths on another disk.
    // Lives outside React so StrictMode / HMR can't re-trigger it.
    bootstrapProjects().catch(() => undefined);
    // Surface backend `notification` events (e.g. failed title generation)
    // as user-visible toasts in the notifications panel.
    initNotificationsListener();
    // Focus the right agent when the user clicks a native push notification
    // sent by the MCP `push_notification` tool.
    initPushNotificationsListener();
    // Dispatch captured initial prompts once their session's worktree is ready.
    initPendingSessionPrompts();
    // Tell the host which session this window shows, so it keeps a warm
    // agent there and the first start skips the spawn + initialize wait.
    initViewingHint();
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
