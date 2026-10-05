/**
 * Host lifecycle — everything the core needs to come up and go down, with no
 * window in sight. The desktop shell calls these around its own window, tray
 * and menu work; `bin/argus-host.ts` calls them and nothing else.
 */

import { registerHostCommands } from "./commands/index";
import { createLogger } from "./logger";
import { stopPowerAssertion } from "./serverMode";
import { destroyAllAgents } from "./services/agent/agentService";
import { reapOrphanedAgentProcesses } from "./services/agent/reapOrphans";
import { initAutomations } from "./services/automation/manager";
import { initAutomationOutcomes } from "./services/automation/outcomes";
import {
  startAutomationScheduler,
  stopAutomationScheduler,
} from "./services/automation/scheduler";
import { stopAllScreencasts } from "./services/browser/cdpScreencast";
import {
  startMjpegServer,
  stopMjpegServer,
} from "./services/browser/mjpegServer";
import { webBrowserPool } from "./services/browser/pool";
import {
  applyActiveAccountToProcessEnv,
  ensureDefaultAccountSeeded,
} from "./services/claudeAuth/accounts";
import { stopAllDebugStreams } from "./services/conductor/debug";
import { initConductorOverride } from "./services/conductor/override";
import { startMcpServer, stopMcpServer } from "./services/mcp/server";
import { installRemoteStatusBroadcast } from "./services/remote/remoteAdmin";
import {
  applyRemoteSettings,
  setRemoteConfig,
  setWebClientDir,
  stopRemote,
} from "./services/remote/remoteService";
import { restoreScratchPads } from "./services/scratchPad/manager";
import { restoreRepoRoots } from "./services/session/manager";
import {
  capture as telemetryCapture,
  initTelemetry,
  shutdownTelemetry,
} from "./services/telemetry/telemetry";
import {
  destroyAllTerminals,
  destroyAllTerminalsAndWait,
} from "./services/terminal/multiplexer";
import { reapOrphanedSpawnHelpers } from "./services/terminal/reapOrphans";
import { fixProcessPath } from "./services/terminal/shellEnv";

const log = createLogger("boot");

export interface StartHostOptions {
  /**
   * Bring the gateway up regardless of the user's remote setting. A headless
   * host has no other way in.
   */
  forceRemote?: boolean;
  /** Built web client to serve over the gateway, if one is available. */
  webClientDir?: string | null;
}

export interface StartedHost {
  /** Settles once the gateway is listening, or with why it failed to start. */
  remoteReady: Promise<{ error: string | null }>;
}

/**
 * Bring the host core up: restore state, start the clock, the MCP server, the
 * gateway and the MJPEG server, and register every host command. Install the
 * platform (`setHostPlatform`) before calling this.
 */
export function startHost(options: StartHostOptions = {}): StartedHost {
  // Anonymous telemetry. Starts in presence mode (one heartbeat per launch);
  // the renderer raises it to full if the user opted in during onboarding.
  initTelemetry();

  // Restore a user-pinned conductor version, installing it in the background
  // if it isn't provisioned yet. Falls back to the bundled version meanwhile.
  initConductorOverride();

  // The projects this host had open last run. Must happen before the gateway
  // accepts anyone: a client hydrates from this set the moment it attaches,
  // and on a headless host nothing else would ever fill it.
  restoreRepoRoots();
  restoreScratchPads();

  initAutomations();
  initAutomationOutcomes();
  startAutomationScheduler();

  // node-pty spawn-helpers and claude subprocesses from prior runs that never
  // got to clean up reparent to launchd and pile up across restarts.
  reapOrphanedSpawnHelpers().catch((err) => {
    log.error("reapOrphanedSpawnHelpers failed:", err);
  });
  reapOrphanedAgentProcesses().catch((err) => {
    log.error("reapOrphanedAgentProcesses failed:", err);
  });

  // A GUI-launched process gets launchd's bare PATH, not the login shell's.
  for (const line of fixProcessPath()) {
    log.info(`[shellEnv] ${line}`);
  }

  // Point this process (and everything inheriting its env) at the active
  // Claude account, adopting any pre-existing `claude` login on first run.
  applyActiveAccountToProcessEnv();
  ensureDefaultAccountSeeded().catch((err) => {
    log.error("Failed to seed the default Claude account:", err);
  });

  startMcpServer().catch((err) => {
    log.error("Failed to start MCP server:", err);
  });

  // Commands first, so nothing that attaches over the gateway finds a gap.
  registerHostCommands();

  setWebClientDir(options.webClientDir ?? null);
  const remoteReady = (
    options.forceRemote
      ? setRemoteConfig({ enabled: true }).then(() => undefined)
      : applyRemoteSettings()
  ).then(
    () => ({ error: null }),
    (err: unknown) => {
      log.error("Failed to start remote access:", err);

      return { error: err instanceof Error ? err.message : String(err) };
    },
  );

  // Push status to every client whenever the tunnel state changes (e.g. a
  // quick tunnel finishing startup and revealing its URL).
  installRemoteStatusBroadcast();

  startMjpegServer().catch((err) => {
    log.error("Failed to start MJPEG server:", err);
  });

  return { remoteReady };
}

/**
 * Stop every long-lived host service that needs no waiting on. Synchronous,
 * so a shell can interleave its own teardown (telling windows to save) before
 * the processes go.
 */
export function stopHostServices(): void {
  telemetryCapture("app_quit");
  shutdownTelemetry().catch(() => undefined);
  stopAutomationScheduler();
  stopMcpServer();
  stopRemote();
  stopMjpegServer();
  stopAllScreencasts();
  stopAllDebugStreams();
  stopPowerAssertion();
  webBrowserPool.releaseAll().catch((err) => {
    log.error("webBrowserPool.releaseAll failed:", err);
  });
}

/**
 * Tear down every PTY and agent subprocess and wait for them to exit, so
 * run-commands and their detached grandchildren don't outlive the host and
 * node-pty's spawn-helpers get reaped instead of reparenting to launchd.
 */
export async function terminateHostProcesses(): Promise<void> {
  await Promise.allSettled([
    destroyAllTerminalsAndWait(1500),
    // `kill()` escalates to SIGKILL after 2 s for a child ignoring SIGTERM.
    destroyAllAgents(),
  ]);
}

/** Orderly shutdown: stop services, then wait for child processes to exit. */
export async function shutdownHost(): Promise<void> {
  stopHostServices();
  await terminateHostProcesses();
}

/**
 * Last-ditch cleanup for exits that skip the orderly path (signals, uncaught
 * exits). Synchronous, so it still runs while the event loop is going away.
 */
export function syncHostCleanup(): void {
  try {
    destroyAllTerminals();
  } catch {
    // Best-effort; we're on the way out.
  }
  try {
    // Kill the tunnel child too, else cloudflared/tailscale orphans.
    stopRemote();
  } catch {
    // Best-effort; we're on the way out.
  }
  stopPowerAssertion();
}
